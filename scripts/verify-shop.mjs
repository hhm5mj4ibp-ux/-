import {
  signEntitlement,
  verifyEntitlement,
  issuePremiumToken,
  shopConfig,
  sessionIsPaid,
} from '../server/shop.mjs';

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('fail:', msg);
    failed += 1;
  }
}

const token = issuePremiumToken('cs_test_1');
assert(!!verifyEntitlement(token), 'issued token verifies');
assert(verifyEntitlement(token).premium === 1, 'payload premium');
assert(!verifyEntitlement(token.slice(0, -2) + 'xx'), 'tamper rejected');
assert(!verifyEntitlement('not-a-token'), 'garbage rejected');

const round = verifyEntitlement(signEntitlement({ premium: 1, exp: Math.floor(Date.now() / 1000) + 60 }));
assert(!!round, 'fresh exp ok');
assert(!verifyEntitlement(signEntitlement({ premium: 1, exp: 1 })), 'expired rejected');
assert(!verifyEntitlement(signEntitlement({ premium: 0 })), 'non-premium rejected');

assert(sessionIsPaid({ payment_status: 'paid' }), 'paid session');
assert(!sessionIsPaid({ payment_status: 'unpaid' }), 'unpaid session');

const cfg = shopConfig();
assert(typeof cfg.enabled === 'boolean', 'config enabled flag');
assert(cfg.product === 'premium', 'product name');

if (failed) {
  console.error('verify-shop failed', failed);
  process.exit(1);
}
console.log('shop entitlement ok');
