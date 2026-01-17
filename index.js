const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const OpenAI = require('openai');
require('dotenv').config();

// Initialize DeepSeek (using OpenAI SDK compatibility)
const openai = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY
});

// Initialize WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'session-new' }),
    puppeteer: {
        args: ['--no-sandbox']
    }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('QR RECEIVED. Scan it with your phone!');
});

let isWhatsappReady = false;

client.on('ready', async () => {
    console.log('Client is ready! (Waiting for hydration...)');
    // Wait a bit to ensure internal models are hydrated
    await new Promise(r => setTimeout(r, 3000));
    isWhatsappReady = true;
    console.log('Client is fully hydrated and ready for broadcast!');
});

client.on('disconnected', (reason) => {
    console.log('Client was disconnected:', reason);
    // client.initialize(); // Optional: Auto-reconnect logic could go here, but usually a restart is safer for now.
});

// --- LOOP PROTECTION ---
const messageCounters = new Map();
// Reset counters every 24 hours
setInterval(() => {
    messageCounters.clear();
    console.log('🧹 Message counters cleared (Daily Reset).');
}, 24 * 60 * 60 * 1000);
// -----------------------

client.on('message', async msg => {
    console.log('DEBUG: Message received full object:', { from: msg.from, body: msg.body, type: msg.type });

    // Avoid replying to status updates or broadcast
    if (msg.from === 'status@broadcast') return;

    // Ignore empty messages or non-chat types
    if (!msg.body || msg.type !== 'chat') return;

    // --- LOOP / SPAM CHECK ---
    const contact = await msg.getContact();
    const senderNumber = contact.number || contact.id.user;

    // Increment counter
    const currentCount = (messageCounters.get(senderNumber) || 0) + 1;
    messageCounters.set(senderNumber, currentCount);

    if (currentCount > 10) {
        console.log(`⛔ Loop protection: Ignoring ${senderNumber} (Message #${currentCount})`);
        return; // Silent ignore after limit
    }

    if (currentCount === 10) {
        // Send final "Stop" message
        await client.sendMessage(msg.from, "Это ИИ-ассистент. Вижу, у нас длинная переписка. Давайте лучше созвонимся? Мой руководитель свяжется с Вами лично.");
        return;
    }
    // -------------------------

    // Log incoming message
    console.log(`Received message from ${msg.from}: ${msg.body}`);

    try {
        // Get chat object to simulate typing
        const chat = await msg.getChat();

        // Get contact to see real number (not LID)
        const contact = await msg.getContact();
        const senderNumber = contact.number || contact.id.user;
        console.log(`Sender Contact Number: +${senderNumber}`);

        // Simulate typing (shows "typing..." status)
        await chat.sendStateTyping();

        // Fetch last 10 messages for context (history)
        // We fetch a bit more to ensure we have context, then map them
        const history = await chat.fetchMessages({ limit: 10 });

        // Format history for AI (oldest first)
        const conversationHistory = history.map(m => ({
            role: m.fromMe ? 'assistant' : 'user',
            content: m.body
        }));

        // Construct the full message list
        const messages = [
            {
                role: "system",
                content: "Ты — личный бизнес-ассистент разработчика (Евгения). Твоя цель — квалифицировать лид (клиента) и договориться о передаче контакта.\n" +
                    "\n" +
                    "ТВОИ ПРАВИЛА ОБЩЕНИЯ (СТРОГО):\n" +
                    "1. ПРАВИЛО 'ОДНОГО ВОПРОСА': Задавай макс. 1 вопрос. Не перегружай.\n" +
                    "2. КРАТКОСТЬ: 1-2 предложения.\n" +
                    "3. ДЕТЕКТОР БОТОВ (КРИТИЧНО ЗАДАНИЕ): Проанализируй сообщение собеседника.\n" +
                    "   - Если собеседник ведет себя как БОТ или МЕНЕДЖЕР (предлагает свои услуги, просит записаться к ним, спрашивает 'Вы хотите записаться?', присылает прайс-лист салона) -> ТЫ ДОЛЖЕН ОТВЕТИТЬ ТОЛЬКО ОДНИМ СЛОВОМ: [IGNORE]\n" +
                    "   - Мы не пытаемся продать боту. Если это автоответчик — мы молчим.\n" +
                    "4. ТОН: Дружелюбный, но деловой. Обращайся на 'Вы'.\n" +
                    "\n" +
                    "СЦЕНАРИЙ (ТОЛЬКО ДЛЯ ЛЮДЕЙ):\n" +
                    "1. Приветствие -> Спроси про их нишу или интерес к сайтам/ботам.\n" +
                    "2. Если говорят 'Хочу ...' -> Уточни детали (магазин, услуги?).\n" +
                    "3. После квалификации -> 'Передал инфо разработчику...' и добавь тег [LEAD]."
            },
            ...conversationHistory
        ];

        const completion = await openai.chat.completions.create({
            messages: messages,
            model: "deepseek-chat",
        });

        let reply = completion.choices[0].message.content;

        // 🛡️ BOT DETECTION CHECK
        if (reply.includes('[IGNORE]')) {
            console.log(`⛔ AI detected a BOT/MANAGER interaction. Ignoring message from ${senderNumber}.`);
            // We exit here, sending NOTHING. Context loop is broken.
            return;
        }

        // Check for [LEAD] tag
        if (reply.includes('[LEAD]')) {
            console.log('🔥 LEAD DETECTED!');

            // Remove tag from reply so user doesn't see it
            reply = reply.replace('[LEAD]', '').trim();

            // Send notification to Telegram
            const notification = `🔥 *Новый лид в WhatsApp!*\n\n` +
                `👤 *Клиент:* +${senderNumber}\n` +
                `💬 *Запрос:* ${msg.body}\n` +
                `🤖 *Ответ бота:* ${reply}`;

            await sendTelegramNotification(notification);
        }

        // Send reply WITHOUT quoting (regular message)
        await client.sendMessage(msg.from, reply);
        console.log(`Replied: ${reply}`);

    } catch (error) {
        console.error('Error generating response:', error);
    }
});

const TelegramBot = require('node-telegram-bot-api');

const fs = require('fs');
const path = require('path');

// --- CAMPAIGN MANAGER ---
const STATE_FILE = path.join(__dirname, 'broadcast_state.json');
const LEADS_FILE = path.join(__dirname, 'leads_salons.json');
const DAILY_LIMIT = 30;
const SEND_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

class CampaignManager {
    constructor() {
        this.state = this.loadState();
        this.timer = null;
    }

    loadState() {
        if (!fs.existsSync(STATE_FILE)) {
            return { isActive: false, lastRunDate: '', dailyCount: 0, processedNumbers: [] };
        }
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }

    saveState() {
        fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
    }

    getLeads() {
        if (!fs.existsSync(LEADS_FILE)) return [];
        return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
    }

    checkDailyReset() {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Almaty' });
        if (this.state.lastRunDate !== today) {
            console.log(`🔄 New day detected (${today}). Resetting daily count.`);
            this.state.lastRunDate = today;
            this.state.dailyCount = 0;
            this.saveState();
        }
    }

    isAlmatyDaytime() {
        const hour = parseInt(new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Almaty', hour12: false, hour: '2-digit' }));
        // Allowed: 10:00 to 20:00
        return hour >= 10 && hour < 20;
    }

    async start() {
        if (this.state.isActive) {
            console.log('⚠️ Campaign is already active.');
            return;
        }
        this.state.isActive = true;
        this.saveState();
        console.log('🚀 Campaign STARTED.');
        this.processQueue();
    }

    stop() {
        this.state.isActive = false;
        this.saveState();
        if (this.timer) clearTimeout(this.timer);
        console.log('🛑 Campaign STOPPED.');
    }

    async processQueue() {
        if (!this.state.isActive) return;

        // 1. Check Time
        if (!this.isAlmatyDaytime()) {
            console.log('🌙 Night time in Almaty. Pausing until morning...');
            // Check again in 30 mins
            this.timer = setTimeout(() => this.processQueue(), 30 * 60 * 1000);
            return;
        }

        // 2. Check Daily Limit
        this.checkDailyReset();
        if (this.state.dailyCount >= DAILY_LIMIT) {
            console.log('✅ Daily limit reached (30). Pausing until tomorrow.');
            // Check again in 30 mins (to catch the date rollover)
            this.timer = setTimeout(() => this.processQueue(), 30 * 60 * 1000);
            return;
        }

        // 3. Get Next Lead
        const leads = this.getLeads();
        // Remove spaces and + from cached phones for comparison
        const processedSet = new Set(this.state.processedNumbers.map(n => n.replace(/\D/g, '')));

        const nextLead = leads.find(l => {
            const clean = l.phone.replace(/\D/g, '');
            return !processedSet.has(clean);
        });

        if (!nextLead) {
            console.log('🏁 All leads processed! Campaign finished.');
            this.stop();
            return;
        }

        // 4. Send Message
        const cleanPhone = nextLead.phone.replace(/\D/g, '');
        const formattedPhone = cleanPhone + '@c.us';
        const promoText = getRandomPromoText(); // Use existing function

        console.log(`📤 Sending to ${nextLead.name} (${formattedPhone})...`);

        try {
            if (isWhatsappReady) {
                await client.sendMessage(formattedPhone, promoText);
                console.log('   ✅ Sent!');

                // Update State
                this.state.dailyCount++;
                this.state.processedNumbers.push(cleanPhone); // Store clean number
                this.saveState();
            } else {
                console.log('   Warning: WhatsApp client not ready. Skipping...');
            }
        } catch (err) {
            console.error(`   ❌ Failed to send: ${err.message}`);
            // Optional: Mark as processed to avoid infinite retry loop on bad number?
            // For now, let's NOT mark it, so it retries later, or add a 'failed' list.
            // Best practice: mark as processed to move on.
            this.state.processedNumbers.push(cleanPhone);
            this.saveState();
        }

        // 5. Schedule Next
        console.log(`⏳ Next message in 5 minutes... (Today: ${this.state.dailyCount}/${DAILY_LIMIT})`);
        this.timer = setTimeout(() => this.processQueue(), SEND_INTERVAL_MS);
    }

    getStatus() {
        const leads = this.getLeads();
        return `📊 *Campaign Status*
Status: ${this.state.isActive ? '🟢 Active' : '🔴 Stopped'}
Date: ${this.state.lastRunDate}
Sent Today: ${this.state.dailyCount} / ${DAILY_LIMIT}
Total Processed: ${this.state.processedNumbers.length} / ${leads.length}
Pool Size: ${leads.length} contacts
        `;
    }
}

const campaignManager = new CampaignManager();

// --- END CAMPAIGN MANAGER ---

// [Old code continues...]
// Initialize Telegram Bot
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const ownerChatId = process.env.TELEGRAM_CHAT_ID;
const bot = new TelegramBot(telegramToken, { polling: true });

// --- CAMPAIGN COMMANDS ---
bot.onText(/\/campaign_start/, async (msg) => {
    const chatId = msg.chat.id;
    if (!isWhatsappReady) {
        bot.sendMessage(chatId, '⚠️ WhatsApp not ready yet.');
        return;
    }
    await campaignManager.start();
    bot.sendMessage(chatId, '🚀 Рассылка ЗАПУЩЕНА.\nИнтервал: 5 минут.\nЛимит: 30/день.\nВремя: Алматы (10-20).');
});

bot.onText(/\/campaign_stop/, async (msg) => {
    const chatId = msg.chat.id;
    campaignManager.stop();
    bot.sendMessage(chatId, '🛑 Рассылка ОСТАНОВЛЕНА.');
});

bot.onText(/\/campaign_status/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, campaignManager.getStatus(), { parse_mode: 'Markdown' });
});

bot.onText(/\/status/, async (msg) => { // Short alias
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, campaignManager.getStatus(), { parse_mode: 'Markdown' });
});
// -------------------------

// Telegram: Handle /promo command
bot.onText(/\/promo/, async (msg) => {
    const chatId = msg.chat.id.toString();

    // Security check: only allow OWNER to trigger broadcast
    if (chatId !== ownerChatId) {
        await bot.sendMessage(chatId, "⛔ У вас нет прав на эту команду.");
        return;
    }

    if (!isWhatsappReady) {
        await bot.sendMessage(chatId, "⚠️ WhatsApp клиент еще не готов. Подождите пару секунд и попробуйте снова.");
        return;
    }

    await bot.sendMessage(chatId, "📣 Начинаю рассылку в WhatsApp...");

    await bot.sendMessage(chatId, "📣 Начинаю рассылку в WhatsApp...");

    // Reverted to manual/test mode per user request (parsing is separate step)
    const TARGET_NUMBERS = ['77774513959'];

    if (TARGET_NUMBERS.length === 0) {
        await bot.sendMessage(chatId, "❌ Список номеров пуст. Рассылка отменена.");
        return;
    }

    let count = 0;
    for (const number of TARGET_NUMBERS) {
        try {
            const waChatId = number.replace(/[^0-9]/g, "") + "@c.us";

            // Generate UNIQUE text for each message
            const promoText = getRandomPromoText();

            console.log(`Sending to +${number}...`);
            await client.sendMessage(waChatId, promoText);
            count++;

            // Random delay 3-10 sec (increased for safety)
            const delay = Math.floor(Math.random() * 7000) + 3000;
            await new Promise(r => setTimeout(r, delay));

        } catch (err) {
            console.error(`❌ Failed to send to ${number}:`, err);
            await bot.sendMessage(chatId, `❌ Ошибка отправки на ${number}: ${err.message}`);
        }
    }

    await bot.sendMessage(chatId, `✅ Рассылка завершена! Успешно отправлено: ${count}`);
});

// Function to generate random variations of the message
function getRandomPromoText() {
    // 1. GREETINGS (Strictly professional)
    const greetings = ['Здравствуйте!', 'Добрый день!', 'Приветствую!', 'Доброго времени суток!'];

    // 2. SELF-PRESENTATION (Expert positioning)
    const intros = [
        'Меня зовут Евгений, я занимаюсь профессиональной разработкой сайтов и внедрением искусственного интеллекта в бизнес.',
        'Я разработчик IT-решений для бизнеса. Специализируюсь на создании продающих сайтов и умных чат-ботов.',
        'Пишет Вам разработчик из Алматы. Я помогаю предпринимателям автоматизировать работу с клиентами через современные технологии.',
        'Хочу представить Вам инструмент, который помогает бизнесу не терять заявки и увеличивать продажи.'
    ];

    // 3. VALUE PROPOSITION (The "Why" - Benefits)
    const bodies = [
        'Этот номер сейчас обслуживает мой ИИ-ассистент. Он работает круглосуточно, мгновенно отвечает на вопросы клиентов и никогда не забывает перезвонить.',
        'Чтобы продемонстрировать возможности автоматизации, я подключил сюда нейросеть. Она заменяет отдел продаж: консультирует, презентует услуги и фиксирует лиды.',
        'Я настроил здесь цифрового сотрудника. Он позволяет экономить время на рутине и обрабатывать входящие запросы даже ночью/в выходные.',
        'Это демонстрация того, как технологии могут работать на Вас. Бот самостоятельно ведет диалог, выявляет потребности и закрывает клиента на целевое действие.'
    ];

    // 4. CALL TO ACTION (Polite invitation to test)
    const actions = [
        'Предлагаю Вам протестировать его работу прямо сейчас. Просто напишите в ответ любое слово (например, «Привет» или «Хочу сайт»).',
        'Напишите в ответ любой вопрос (например, «Сколько стоит бот?»), и посмотрите, как грамотно и быстро он ответит.',
        'Чтобы увидеть систему в действии, отправьте любое сообщение. Это бесплатно и ни к чему Вас не обязывает.',
        'Попробуйте написать ему «Цена» или «Услуги» — Вы увидите, как работает современный сервис поддержки.'
    ];

    // 5. FOOTER (Business outcome + Websites/Automation)
    const footers = [
        'P.S. Если Вам понравится, я могу разработать аналогичного бота или сайт персонально под Ваш бизнес.',
        'P.S. Мы внедряем не только ботов, но и полную автоматизацию продаж (сайты, CRM).',
        'P.S. Разрабатываю сайты любой сложности и автоматизирую рутину. Готов обсудить Ваши задачи.',
        'P.S. Буду рад обсудить, как сайт или бот может сэкономить бюджет Вашей компании.'
    ];

    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    return `${pick(greetings)} 👋\n\n${pick(intros)}\n\n${pick(bodies)}\n\n${pick(actions)}\n\n${pick(footers)}`;
}

// Helper function to send Telegram notifications (Replaces fetch)
async function sendTelegramNotification(text) {
    try {
        await bot.sendMessage(ownerChatId, text, { parse_mode: 'Markdown' });
        console.log('Telegram notification sent successfully.');
    } catch (error) {
        console.error('Failed to send Telegram notification:', error);
    }
}

client.initialize();


