const deck = document.querySelector('[data-qr-deck]');
const slides = [...document.querySelectorAll('[data-qr-slide]')];
const dots = [...document.querySelectorAll('[data-qr-dot]')];
const prevButton = document.querySelector('[data-qr-prev]');
const nextButton = document.querySelector('[data-qr-next]');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let currentIndex = 0;

function goTo(index) {
  slides[index]?.scrollIntoView({
    behavior: prefersReducedMotion.matches ? 'auto' : 'smooth',
    block: 'nearest',
    inline: 'start',
  });
}

function setCurrent(index) {
  currentIndex = index;
  dots.forEach((dot, dotIndex) => {
    if (dotIndex === index) dot.setAttribute('aria-current', 'true');
    else dot.removeAttribute('aria-current');
  });
  if (prevButton) prevButton.disabled = index === 0;
  if (nextButton) nextButton.disabled = index === slides.length - 1;
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

  prevButton?.addEventListener('click', () => goTo(Math.max(currentIndex - 1, 0)));
  nextButton?.addEventListener('click', () => goTo(Math.min(currentIndex + 1, slides.length - 1)));

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;

    goTo(
      event.key === 'ArrowRight'
        ? Math.min(currentIndex + 1, slides.length - 1)
        : Math.max(currentIndex - 1, 0),
    );
  });
}
