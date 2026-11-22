import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactForShare } from '../lib/shareFormats';

test('shared formats keep the wording but drop personal details', () => {
  const cases: Array<[string, RegExp[], RegExp[]]> = [
    ['Dear VIKAS VERMA,\nThank you for using your HDFC Bank Card XX1639 for Rs. 799.0 at YOUTUBEGOOGLE on 01-10-2026 13:01:41 .', [/Thank you for using your HDFC Bank Card XX0000 for Rs\. 000\.0 at PAYEE NAME on 00-00-0000 00:00:00/, /Dear Customer,/], [/VIKAS|1639|799|YOUTUBE/]],
    ['Transaction Amount: INR 2052\nMerchant Name: PYU*Flipkar\nAxis Bank Credit Card No. XX6754\nDate & Time: 08-10-2026, 11:26:53 IST', [/Merchant Name: PAYEE NAME/, /Axis Bank Credit Card No\. XX0000/], [/Flipkar|6754|2052/]],
    ['Rs.340.00 has been debited from account **7788 to VPA zomato.payu@hdfcbank ZOMATO LIMITED on 20-11-26.', [/to VPA name@bank/], [/zomato\.payu|7788/]],
    ['INR 62,000.00 has been debited from your account ending xxxxxxxxxx8848 on 05-11-26 and credited to the account ending xxxxxxxxxx8611 via IMPS.', [/debited from your account ending xxxxxxxxxx0000 on 00-00-00 and credited to the account ending/], [/8848|8611|62,000/]],
  ];
  for (const [input, keep, gone] of cases) {
    const out = redactForShare(input);
    for (const k of keep) assert.match(out, k, out);
    for (const g of gone) assert.doesNotMatch(out, g, out);
  }
});
