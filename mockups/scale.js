// Shrinks device-mockup frames to fit their container on narrow screens, so the
// whole screen is always visible instead of overflowing or squeezing its contents.
(function () {
  function fit() {
    document.querySelectorAll('.tablet-frame, .tool-frame, .tool-phone-frame').forEach(function (el) {
      el.style.zoom = 1;
      var container = el.parentElement;
      var cs = getComputedStyle(container);
      var avail = container.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      var natural = el.getBoundingClientRect().width;
      var ratio = Math.min(1, avail / natural);
      el.style.zoom = ratio > 0 ? ratio : 1;
    });
  }
  window.addEventListener('resize', fit);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fit);
  } else {
    fit();
  }
  window.addEventListener('load', fit);
})();
