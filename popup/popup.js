document.addEventListener('DOMContentLoaded', () => {
  const shell = document.querySelector('.wb-shell');
  const revealItems = document.querySelectorAll('[data-reveal]');

  revealItems.forEach((el, index) => {
    el.style.setProperty('--reveal-delay', `${200 + index * 90}ms`);
  });

  requestAnimationFrame(() => {
    shell?.classList.add('wb-ready');
  });
});
