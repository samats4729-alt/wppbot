const { Client, LocalAuth } = require('whatsapp-web.js');
require('dotenv').config();

// Configuration
const TARGET_NUMBERS = ['77774513959']; // Format: plain numbers without + or @c.us
const MESSAGE = `Здравствуйте! 👋 Я разработчик из Алматы.

Чтобы не упускать клиентов, пока я занят кодом, я подключил к этому номеру ИИ-ассистента. Он сам отвечает на вопросы и принимает заявки.

Напишите в ответ любое слово (например «Привет» или «Цена»), чтобы посмотреть, как он работает.

P.S. Если понравится — могу внедрить такого же вам.`;

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'session-new' }), // Usage of same session
    puppeteer: {
        args: ['--no-sandbox']
    }
});

client.on('ready', async () => {
    console.log('Broadcast Client is ready!');

    for (const number of TARGET_NUMBERS) {
        try {
            // Check if number is registered on WhatsApp
            const sanitized_number = number.toString().replace(/[^0-9]/g, "");
            const chatId = sanitized_number + "@c.us";

            console.log(`Sending to +${sanitized_number}...`);
            await client.sendMessage(chatId, MESSAGE);
            console.log('✅ Sent successfully!');

            // Small delay to be safe
            await new Promise(r => setTimeout(r, 2000));

        } catch (err) {
            console.error(`❌ Failed to send to ${number}:`, err);
        }
    }

    console.log('Broadcast finished. Closing client...');
    await client.destroy();
    process.exit(0);
});

client.on('authenticated', () => {
    console.log('AUTHENTICATED');
});

client.on('auth_failure', msg => {
    console.error('AUTHENTICATION FAILURE', msg);
});

console.log('Starting broadcast script...');
client.initialize();
