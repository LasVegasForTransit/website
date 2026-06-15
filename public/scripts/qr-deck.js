const deck = document.querySelector('[data-qr-deck]');
const slides = [...document.querySelectorAll('[data-qr-slide]')];
const dots = [...document.querySelectorAll('[data-qr-dot]')];
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let currentIndex = 0;

function setCurrent(index) {
  currentIndex = index;
  dots.forEach((dot, dotIndex) => {
    if (dotIndex === index) dot.setAttribute('aria-current', 'true');
    else dot.removeAttribute('aria-current');
  });
}

if (deck && slides.length > 0) {
  const observer = new IntersectionObserver(
    (entries) => {
      const active = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (!active) return;
      setCurrent(Number(active.target.getAttribute('data-qr-index') ?? 0));
    },
    {
      root: deck,
      threshold: [0.55, 0.75],
    },
  );

  slides.forEach((slide) => observer.observe(slide));

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;

    const next =
      event.key === 'ArrowRight'
        ? Math.min(currentIndex + 1, slides.length - 1)
        : Math.max(currentIndex - 1, 0);

    slides[next]?.scrollIntoView({
      behavior: prefersReducedMotion.matches ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'start',
    });
  });
}
