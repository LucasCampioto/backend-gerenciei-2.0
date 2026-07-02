const crypto = require('crypto');

// Gerar um JWT_SECRET seguro
const jwtSecret = crypto.randomBytes(64).toString('hex');

console.log('\n🔐 JWT_SECRET gerado com sucesso!\n');
console.log('='.repeat(80));
console.log(jwtSecret);
console.log('='.repeat(80));
console.log('\n📋 Copie o valor acima e adicione na Vercel como variável de ambiente:');
console.log('   Nome: JWT_SECRET');
console.log('   Valor: (cole o valor acima)');
console.log('\n💡 Você pode adicionar via:');
console.log('   - Dashboard da Vercel: Settings → Environment Variables');
console.log('   - CLI: vercel env add JWT_SECRET production\n');

