(() => {
  const evidence = JSON.parse(document.getElementById('case-evidence').textContent);
  const number = value => new Intl.NumberFormat('en-US').format(value);
  const fixed = evidence.summary.runs.filter(run => run.variant === 'fixed');
  document.getElementById('fixed-count').textContent = number(fixed.reduce((sum, run) => sum + run.pass, 0));
  document.getElementById('snapshot-date').textContent = evidence.summary.created_at_utc.replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  for (const card of document.querySelectorAll('[data-case]')) {
    const slug = card.dataset.case;
    const render = variant => {
      const run = evidence.summary.runs.find(run => run.slug === slug && run.variant === variant);
      const data = evidence.observations[slug][variant];
      const panel = card.querySelector('.case-result');
      panel.replaceChildren();
      const add = (tag, cls, text, parent = panel) => { const node = document.createElement(tag); node.className = cls; node.textContent = text; parent.append(node); return node; };
      add('p', 'result-label', 'Recorded synthetic acceptance run');
      add('span', 'status' + (variant === 'fixed' ? '' : ' refuted'), variant === 'fixed' ? 'ACCEPTANCE PASSED' : 'FAULT DETECTED AS EXPECTED');
      add('p', 'result-heading', variant === 'fixed' ? 'The corrected model meets the checked contract.' : variant === 'before' ? 'The modeled failure breaks the contract.' : 'A narrower restored fault is detected.');
      const grid = add('div', 'result-grid', '');
      const metric = (value, label) => { const box = add('div', '', '', grid); add('strong', '', value, box); add('span', '', label, box); };
      metric(`${run.pass} / ${run.tests}`, 'acceptance tests passed'); metric(String(run.fail), 'acceptance tests failed');
      let observation;
      if (slug === 'document-sync') observation = `After reload and save: ${data.attemptedSave}. The server contains “${data.storedDocument.text}”. Accepted writes: ${data.acceptedWrites}.`;
      if (slug === 'upload-integrity') {
        const copies = Object.values(data.largeOriginal.independentReadbacks).filter(copy => copy.matchesOriginal).length;
        observation = `Large original: ${number(data.largeOriginal.bytes)} bytes. Independent complete readbacks: ${copies} / 3. Reported redundancy: ${data.largeOriginal.receipt.redundancy}. The aggregate modeled envelope is ${number(data.largeOriginal.aggregateEnvelopeBytes)} bytes.`;
      }
      if (slug === 'upload-integrity' && variant === 'regression') {
        const readbacks = Object.values(data.acknowledgedTruncation.independentReadbacks).filter(copy => copy.matchesOriginal).length;
        observation = `The large original uses bounded writes. In the acknowledged-truncation control, only ${readbacks} / 3 copies match the original, yet the receipt reports ${data.acknowledgedTruncation.receipt.redundancy} redundancy. The acceptance tests detect this disagreement.`;
      }
      if (slug === 'bounded-escalation') observation = `Eight drains: ${data.observations.unidentified_session.sessionsLaunched} unidentified-session launches; ${data.observations.unknown_inventory.sessionsLaunched} launches with unknown inventory. Undelivered events remain: ${data.observations.unidentified_session.undeliveredEvents}.`;
      add('p', 'observation', observation);
      for (const button of card.querySelectorAll('[data-variant]')) button.setAttribute('aria-pressed', String(button.dataset.variant === variant));
    };
    for (const button of card.querySelectorAll('[data-variant]')) button.addEventListener('click', () => render(button.dataset.variant));
    render('fixed');
  }
  document.getElementById('copy-command').addEventListener('click', async () => {
    const text = 'git clone https://github.com/seris10/roots-of-reason-qa.git\ncd roots-of-reason-qa\nnode scripts/reproduce.mjs';
    try { await navigator.clipboard.writeText(text); document.getElementById('copy-status').textContent = 'Commands copied.'; }
    catch { document.getElementById('copy-status').textContent = 'Select the commands above to copy them.'; }
  });
})();
