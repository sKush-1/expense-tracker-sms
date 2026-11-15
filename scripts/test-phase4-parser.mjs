import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { lookupSender, getRegisteredHeaderCount } from '../src/parser/sender-registry.ts';
import { extractAmount } from '../src/parser/extractors/amount.ts';
import { extractBalance } from '../src/parser/extractors/balance.ts';
import { extractAccount } from '../src/parser/extractors/account.ts';
import { extractReference } from '../src/parser/extractors/reference.ts';
import { extractMerchant } from '../src/parser/extractors/merchant.ts';
import { detectTransaction } from '../src/parser/detector.ts';
import { defaultParserRegistry } from '../src/parser/parser.registry.ts';

console.log('--- Phase 4 Offline Parser Evaluation ---');
console.log('Registered TRAI headers loaded:', getRegisteredHeaderCount());

// Read all messages from /tmp/sms_tracker.db via sqlite3
const jsonOut = execSync(
  `sqlite3 /tmp/sms_tracker.db "SELECT id, sender, message, received_at FROM sms_messages ORDER BY id ASC;" -json`,
  { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
);

const messages = JSON.parse(jsonOut);
console.log('Total SMS messages in DB:', messages.length);

let totalParsed = 0;
let debits = 0;
let credits = 0;
let refunds = 0;
const parsedTransactions = [];
const rejectedOtps = [];
const rejectedFailed = [];

for (const msg of messages) {
  const result = defaultParserRegistry.parse(msg.sender, msg.message, msg.received_at);
  if (result) {
    totalParsed++;
    if (result.transactionType === 'debit') debits++;
    else if (result.transactionType === 'credit') credits++;
    else if (result.transactionType === 'refund') refunds++;
    parsedTransactions.push({ msg, result });
  } else {
    if (/otp|verification code|login code/i.test(msg.message)) {
      rejectedOtps.push(msg);
    }
    if (/failed|declined/i.test(msg.message)) {
      rejectedFailed.push(msg);
    }
  }
}

console.log('\n--- Detection Results ---');
console.log('Total detected transactions:', totalParsed);
console.log('  Debits :', debits);
console.log('  Credits:', credits);
console.log('  Refunds:', refunds);
console.log('Sample OTP messages correctly rejected:', rejectedOtps.length);
console.log('Sample Failed messages correctly rejected:', rejectedFailed.length);

console.log('\n--- First 5 Extracted Transactions ---');
for (const item of parsedTransactions.slice(0, 5)) {
  console.log({
    id: item.msg.id,
    sender: item.msg.sender,
    bankName: item.result.bankName,
    type: item.result.transactionType,
    amountRupees: (item.result.amountPaise / 100).toFixed(2),
    account: item.result.accountIdentifier,
    ref: item.result.referenceNumber,
    merchant: item.result.merchant,
    balanceRupees: item.result.balancePaise !== null ? (item.result.balancePaise / 100).toFixed(2) : null,
    sampleSnippet: item.msg.message.slice(0, 70) + '...',
  });
}
