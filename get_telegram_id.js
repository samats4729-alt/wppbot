const https = require('https');
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
    console.error('Error: TELEGRAM_BOT_TOKEN is missing in .env');
    process.exit(1);
}

const url = `https://api.telegram.org/bot${token}/getUpdates`;

https.get(url, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        try {
            const response = JSON.parse(data);
            if (!response.ok) {
                console.error('Error from Telegram API:', response.description);
                return;
            }

            const updates = response.result;
            if (updates.length === 0) {
                console.log('No messages found. Please send a message to your bot first!');
            } else {
                const lastUpdate = updates[updates.length - 1];
                const chatId = lastUpdate.message.chat.id;
                const firstName = lastUpdate.message.chat.first_name;
                console.log(`\n🎉 SUCCESS! Found Chat ID for ${firstName}:`);
                console.log(`Chat ID: ${chatId}`);
                console.log('\nCopy this ID and I will add it to your configuration.');
            }
        } catch (e) {
            console.error('Error parsing response:', e);
        }
    });
}).on('error', (e) => {
    console.error('Error fetching updates:', e);
});
