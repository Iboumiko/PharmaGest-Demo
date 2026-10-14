/* PharmaGest — optimisation réseau local v16
 * Précharge les pages au survol/toucher d'un lien de navigation.
 * Le navigateur peut alors réutiliser la réponse HTML depuis son cache local.
 * Aucun appel API n'est effectué par ce script et aucune donnée métier n'est mise en cache.
 */
(() => {
  const prefetched = new Set();

  function prefetch(url) {
    if (!url || prefetched.has(url) || url.startsWith('#')) return;
    if (!/\.html(?:$|\?)/i.test(url)) return;
    if (url.startsWith('http') && !url.startsWith(location.origin)) return;

    prefetched.add(url);
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = 'document';
    link.href = url;
    document.head.appendChild(link);
  }

  function handle(target) {
    const link = target?.closest?.('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (href) prefetch(href);
  }

  document.addEventListener('pointerover', e => handle(e.target), { passive: true });
  document.addEventListener('touchstart', e => handle(e.target), { passive: true });
})();
