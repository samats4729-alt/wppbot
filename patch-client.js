const fs = require('fs');
const path = require('path');

const clientPath = path.join(__dirname, 'node_modules', 'whatsapp-web.js', 'src', 'Client.js');

if (fs.existsSync(clientPath)) {
    let content = fs.readFileSync(clientPath, 'utf8');

    // Patch: Disable sendSeen to prevent 'markedUnread' error
    // Original: if (sendSeen) {
    // Replacement: if (false && sendSeen) {

    const patchedContent = content.replace('if (sendSeen) {', 'if (false && sendSeen) {');

    if (content !== patchedContent) {
        fs.writeFileSync(clientPath, patchedContent, 'utf8');
        console.log('✅ Successfully patched Client.js to disable sendSeen!');
    } else {
        console.log('⚠️ Pattern not found or already patched.');
    }
} else {
    console.error('❌ Client.js not found at:', clientPath);
    process.exit(1);
}
