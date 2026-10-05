import { generateKeysForEnv } from './src/utils/jwtKeys';

const { privateKeyB64, publicKeyB64 } = generateKeysForEnv();

console.log('=== ADICIONE AO SEU .env ===');
console.log(`JWT_PRIVATE_KEY_B64=${privateKeyB64}`);
console.log(`JWT_PUBLIC_KEY_B64=${publicKeyB64}`);
console.log('============================');