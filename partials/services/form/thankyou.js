import { readReceipt, savedMessage } from './form-protocol.js';

const initialized = new WeakSet();
function initThankyou() {
  const message = document.getElementById('confirmedRequestMessage');
  if (!message || initialized.has(message)) return;
  initialized.add(message);
  const receipt = readReceipt();
  if (!receipt?.result?.ok) return;
  document.getElementById('thankyouHeading').textContent = receipt.result.state === 'complete' ? 'Thank You!' : 'Request received';
  message.textContent = savedMessage(receipt.result);
  const reference = document.getElementById('confirmedRequestReference');
  reference.textContent = `Reference: ${receipt.requestId}`;
  reference.hidden = false;
}
document.addEventListener('includes:ready', initThankyou);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initThankyou, { once: true });
else initThankyou();
