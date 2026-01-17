const puppeteer = require('puppeteer');

(async () => {
    console.log('🚀 Starting 2GIS Parser...');

    // Launch browser
    const browser = await puppeteer.launch({
        headless: false, // Show browser for debugging
        defaultViewport: null,
        args: ['--start-maximized']
    });

    const page = await browser.newPage();

    try {
        console.log('🌍 Navigating to 2GIS Almaty...');
        await page.goto('https://2gis.kz/almaty', { waitUntil: 'networkidle2' });

        console.log('✅ Page loaded. Ready for search.');

        // 1. Find Search Input and Type Query
        const searchSelector = 'input[type="text"]';
        await page.waitForSelector(searchSelector);

        // Clear input first just in case
        await page.click(searchSelector, { clickCount: 3 });
        await page.type(searchSelector, 'Парикмахерская'); // Updated query
        await page.keyboard.press('Enter');

        console.log('🔍 Search started for "Парикмахерская"...');

        // 2. Wait for results list
        await page.waitForFunction(() => document.querySelectorAll('div[class*="_1kf6gff"]').length > 0 || document.body.innerText.includes('Парикмахерская'), { timeout: 10000 });

        console.log('📋 Results list appeared. Starting to scroll...');

        // 3. Scroll the specific results container
        // In 2GIS, the list is usually in a scrollable div inside the sidebar.
        // We will try to find it by looking for the largest scrollable element or just standard window scroll if it works (often logic is captured there)
        // A safer bet for 2GIS is hovering the sidebar and using mouse wheel.

        // Focus on the sidebar using Javascript to find the scroll parent
        console.log('🔄 Collecting links with PAGINATION (Target: ~1000 items)...');

        const allLinks = new Set();
        let pageNum = 1;
        const MAX_PAGES = 200; // Large limit for "infinite" feel (approx 2400 salons)

        let consecutiveNoNewItems = 0;

        while (pageNum <= MAX_PAGES) {
            console.log(`📄 Scraper: Processing Page ${pageNum}/${MAX_PAGES}...`);

            // 1. Wait a bit for render
            await new Promise(r => setTimeout(r, 2000));

            // 2. Scrape visible links on this page AND normalize them
            // We strip query params (?stat=...) and sub-paths (/tab/...)
            const currentLinks = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a[href^="/almaty/firm/"]'))
                    .map(a => {
                        let href = a.href;
                        // Normalize: remove query params and tabs
                        href = href.split('?')[0];
                        href = href.split('/tab/')[0];
                        return href;
                    });
            });

            const beforeCount = allLinks.size;
            // Add only clean unique links
            currentLinks.forEach(link => {
                // Ensure it looks like a firm link (not just /almaty/firm/)
                if (link.match(/\/firm\/\d+/)) {
                    allLinks.add(link);
                }
            });

            const newFound = allLinks.size - beforeCount;
            console.log(`   + Found ${currentLinks.length} raw items -> ${newFound} NEW unique. Total unique: ${allLinks.size}`);

            // STUCK DETECTOR
            if (newFound === 0) {
                consecutiveNoNewItems++;
                console.log(`   ⚠️ No new items found (Attempt ${consecutiveNoNewItems}/3)`);
                if (consecutiveNoNewItems >= 3) {
                    console.log('🛑 Looks like we reached the end or are stuck. Stopping pagination.');
                    break;
                }
            } else {
                consecutiveNoNewItems = 0;
            }

            if (currentLinks.length === 0 && pageNum === 1) {
                console.log('⚠️ Warning: No items found on page 1. Check selectors.');
            }

            // 3. Go to Next Page
            if (pageNum < MAX_PAGES) {
                // Capture ALL current links to compare later (State Before)
                const linksBefore = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('a[href^="/almaty/firm/"]'))
                        .map(a => a.href);
                });

                let nextClicked = await page.evaluate(async (currentPageNum) => {
                    // Robust Pagination Finder
                    // 1. Gather all potential page number buttons (small numbers)
                    // We cast to Array to use filter/map
                    const allElements = Array.from(document.querySelectorAll('div, span, a, button'));

                    // Filter for elements that look like page numbers (1, 2, 3...)
                    const pageButtons = allElements.filter(el => {
                        const txt = el.innerText.trim();
                        // Exact match for digits, length < 3
                        return /^\d+$/.test(txt) && txt.length < 4;
                    });

                    // 2. Find the container that holds these buttons (the parent)
                    // Heuristic: The pagination container has multiple children that are page numbers.
                    const parents = new Map();
                    pageButtons.forEach(btn => {
                        const p = btn.parentElement;
                        if (p) {
                            if (!parents.has(p)) parents.set(p, 0);
                            parents.set(p, parents.get(p) + 1);
                        }
                    });

                    // Find the best candidate for pagination container
                    let paginationContainer = null;
                    let maxCount = 0;
                    for (const [parent, count] of parents.entries()) {
                        if (count >= 2 && count > maxCount) {
                            paginationContainer = parent;
                            maxCount = count;
                        }
                    }

                    if (!paginationContainer) {
                        console.log('DBG: No explicit pagination container found. Trying loose search for:', currentPageNum + 1);
                        // Fallback: Just look for the next number anywhere
                        const targetNum = String(currentPageNum + 1);
                        const btn = pageButtons.find(b => b.innerText.trim() === targetNum);
                        if (btn) {
                            console.log(`Clicking loose page number: ${targetNum}`);
                            btn.scrollIntoView({ block: 'center' });
                            btn.click();
                            return true;
                        }
                        return false;
                    }

                    // We have a container!
                    console.log('DBG: Found pagination container with', maxCount, 'numbers.');

                    // Priority 1: Find exact number "pageNum + 1" inside this container
                    const targetNum = String(currentPageNum + 1);
                    // Check specific children of the container
                    const targetBtn = Array.from(paginationContainer.querySelectorAll('*')).find(child => child.innerText.trim() === targetNum);

                    if (targetBtn) {
                        console.log(`Clicking exact page number in container: ${targetNum}`);
                        targetBtn.scrollIntoView({ block: 'center' });
                        targetBtn.click();
                        return true;
                    }

                    // Priority 2: Click the "Next" arrow (usually the last child)
                    const lastChild = paginationContainer.lastElementChild;
                    // Ensure we are not clicking the current page number if it happens to be last (unlikely for "Next")
                    if (lastChild && lastChild.innerText.trim() !== String(currentPageNum)) {
                        console.log('Clicking "Next" arrow (last child)');
                        lastChild.scrollIntoView({ block: 'center' });
                        lastChild.click();
                        return true;
                    }

                    return false;
                }, pageNum);

                if (nextClicked) {
                    console.log('   ➡️ Clicked "Next". Waiting for content change...');

                    // SMART WAIT: Wait until the set of links changes
                    try {
                        await page.waitForFunction(
                            (oldLinks) => {
                                const newLinks = Array.from(document.querySelectorAll('a[href^="/almaty/firm/"]'))
                                    .map(a => a.href);

                                // Check if arrays are different length OR have different content
                                if (newLinks.length !== oldLinks.length) return true;

                                // Check if at least one link is different (ads are usually at top)
                                // If the last link is different, it's a good indicator of new content.
                                const lastOld = oldLinks[oldLinks.length - 1];
                                const lastNew = newLinks[newLinks.length - 1];
                                return lastOld !== lastNew;
                            },
                            { timeout: 10000 },
                            linksBefore
                        );
                        console.log('   ✅ Content updated!');
                        pageNum++;
                    } catch (e) {
                        console.log('   ⚠️ Warning: Page content did not change. Sticky ads or end of list?');
                        // Force increment to keep trying next iteration logic
                        pageNum++;
                    }
                } else {
                    console.log('🛑 No "Next" button found (or end of list). Finished.');
                    break;
                }
            } else {
                pageNum++;
            }
        }

        console.log('🛑 Pagination finished.');
        const links = Array.from(allLinks);

        console.log(`🔗 Final count: ${links.length} unique links. Starting extraction...`);

        const leads = [];
        const extractedPhones = new Set(); // To prevent duplicates across different links
        const fs = require('fs');

        // Process ALL links (no limit)
        // Adding a safety slice just in case it's huge, but allow up to 100 for now
        const itemsToProcess = links;

        for (let i = 0; i < itemsToProcess.length; i++) {
            const link = itemsToProcess[i];
            console.log(`[${i + 1}/${itemsToProcess.length}] Processing: ${link}`);

            try {
                // Navigate to specific firm page
                await page.goto(link, { waitUntil: 'load', timeout: 30000 });

                // Get Name
                const name = await page.evaluate(() => {
                    const h1 = document.querySelector('h1');
                    return h1 ? h1.innerText : 'Unknown';
                });

                // Click "Show Phone" if exists
                // 2GIS often hides phone. We look for a button or link with specific behavior
                // Common text: "Показать телефон" or icon.
                // We'll try to find any element containing 'tel:' in href OR a button that looks like phone reveal

                // Wait a bit for dynamic load
                await new Promise(r => setTimeout(r, 1500));

                // 2GIS specific: Phone might be under a button or already visible
                // Let's look for tel links first
                let phone = await page.evaluate(() => {
                    const telLink = document.querySelector('a[href^="tel:"]');
                    return telLink ? telLink.href.replace('tel:', '') : null;
                });

                if (!phone) {
                    console.log('   ...trying to locate "Show Phone" button');
                    // Try to click "Показать телефон"
                    // It's often a div or button.
                    const clicked = await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('div, button, span'));
                        const showBtn = buttons.find(b => b.innerText && b.innerText.includes('Показать телефон'));
                        if (showBtn) {
                            showBtn.click();
                            return true;
                        }
                        return false;
                    });

                    if (clicked) {
                        await new Promise(r => setTimeout(r, 1000));
                        phone = await page.evaluate(() => {
                            const telLink = document.querySelector('a[href^="tel:"]');
                            return telLink ? telLink.href.replace('tel:', '') : null;
                        });
                    }
                }

                if (phone) {
                    // Start formatting & deduplication
                    const cleanPhone = phone.replace(/\D/g, '');

                    if (extractedPhones.has(cleanPhone)) {
                        console.log(`   ⚠️ Duplicate phone ${cleanPhone} skipped.`);
                    } else {
                        console.log(`   📞 Found: ${phone}`);
                        leads.push({ name, phone });
                        extractedPhones.add(cleanPhone);
                    }
                } else {
                    console.log('   Warning: No phone found.');
                }

                // PERIODIC SAVE (Safety net)
                if (leads.length % 5 === 0 && leads.length > 0) {
                    try {
                        fs.writeFileSync('leads_salons.json', JSON.stringify(leads, null, 2));
                        console.log(`   💾 Autosaved ${leads.length} leads...`);
                    } catch (saveErr) {
                        console.error(`   ❌ Error during autosave: ${saveErr.message}`);
                    }
                }

            } catch (err) {
                console.error(`   ❌ Error processing ${link}:`, err.message);
            }
        }

        console.log('🎉 Done! Leads:', leads);

        // Save to file (JSON)
        fs.writeFileSync('leads_salons.json', JSON.stringify(leads, null, 2));
        console.log('💾 Final save to leads_salons.json');

        // Keep browser open
        // await browser.close();

    } catch (error) {
        console.error('❌ Error:', error);
        await browser.close();
    }
})();
