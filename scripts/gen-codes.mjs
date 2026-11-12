// Gera códigos Premium pessoais para a variável PREMIUM_CODES da Vercel.
// Uso: node scripts/gen-codes.mjs maria joao     (uma etiqueta por cliente)
//      node scripts/gen-codes.mjs --count 3       (3 códigos sem etiqueta)
// A etiqueta aparece nos registos do servidor (para veres o uso por cliente): usa iniciais ou um apelido, não dados pessoais.
import { randomInt } from 'node:crypto';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I para evitar confusões ao ditar
const code = () => Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ALPHA[randomInt(ALPHA.length)]).join('')).join('-'); // 16 símbolos (~80 bits)
const args = process.argv.slice(2);
let labels = args;
if (args[0] === '--count') labels = Array.from({ length: Math.max(1, Math.min(100, Number(args[1]) || 1)) }, () => '');
if (!labels.length) { console.error('Uso: node scripts/gen-codes.mjs etiqueta1 etiqueta2 ...   ou   --count N'); process.exit(1); }
const bad = labels.filter(l => l && !/^[A-Za-z0-9_-]{1,32}$/.test(l));
if (bad.length) { console.error('Etiquetas inválidas (só letras, números, _ e -, máx. 32): ' + bad.join(', ')); process.exit(1); }
const entries = labels.map(l => (l ? `${l}=` : '') + code());
console.log('Entregar ao cliente apenas a parte depois do "=" (ou o código inteiro, se não tiver etiqueta):\n');
for (const e of entries) console.log('  ' + e);
console.log('\nAcrescenta à variável PREMIUM_CODES da Vercel (separados por vírgula, sem espaços) e volta a publicar:\n\n  ' + entries.join(',') + '\n');
