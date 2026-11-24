'use strict';
// 浅色 / 深色主题: 首次跟随系统, 之后记住用户选择。放在 <head> 里同步执行, 避免启动时闪一下另一种配色。
(function () {
  const KEY = 'gm108-theme';
  const root = document.documentElement;
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  const sysLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const apply = t => { root.dataset.theme = t; };
  apply(saved === 'light' || saved === 'dark' ? saved : (sysLight ? 'light' : 'dark'));
  window.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-theme');
    if (!btn) return;
    const sync = () => { btn.title = root.dataset.theme === 'light' ? '切换到深色' : '切换到浅色'; };
    sync();
    btn.addEventListener('click', () => {
      const next = root.dataset.theme === 'light' ? 'dark' : 'light';
      apply(next); sync();
      try { localStorage.setItem(KEY, next); } catch {}
    });
  });
})();
