// Shrinks device-mockup frames to fit their container on narrow screens, so the
// whole screen is always visible instead of overflowing or squeezing its contents.
// Uses transform:scale (universal support) rather than CSS zoom (inconsistent
// cross-browser support, notably older Safari/Firefox), wrapping each frame in a
// runtime-created container so the scaled-down box still reserves the right space.
(function () {
  function fit() {
    document.querySelectorAll('.tablet-frame, .tool-frame, .tool-phone-frame').forEach(function (el) {
      var wrap = el.parentElement;
      if (!wrap.classList.contains('device-scale')) {
        var w = document.createElement('div');
        w.className = 'device-scale';
        wrap.insertBefore(w, el);
        w.appendChild(el);
        wrap = w;
      }
      el.style.transform = 'none';
      wrap.style.width = '';
      wrap.style.height = '';
      var outer = wrap.parentElement;
      var cs = getComputedStyle(outer);
      var avail = outer.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      var rect = el.getBoundingClientRect();
      var ratio = Math.min(1, avail / rect.width);
      el.style.transformOrigin = 'top left';
      el.style.transform = 'scale(' + ratio + ')';
      wrap.style.width = (rect.width * ratio) + 'px';
      wrap.style.height = (rect.height * ratio) + 'px';
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
