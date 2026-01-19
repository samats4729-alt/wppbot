const fs = require('fs');

// Read leads file
const leads = JSON.parse(fs.readFileSync('leads_salons.json', 'utf8'));
console.log(`Current leads count: ${leads.length}`);

// Remove first 50
const remaining = leads.slice(50);
console.log(`After removing 50: ${remaining.length} leads remaining`);

// Save back
fs.writeFileSync('leads_salons.json', JSON.stringify(remaining, null, 2));
console.log('✅ Saved leads_salons.json');

// Show first 3 remaining leads
console.log('\nFirst 3 remaining leads:');
remaining.slice(0, 3).forEach((l, i) => console.log(`  ${i + 1}. ${l.name} - ${l.phone}`));
