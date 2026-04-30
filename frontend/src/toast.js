let _dispatch = null;

export const initToast = (fn) => { _dispatch = fn; };

export const toast = {
  success: (msg, dur) => _dispatch?.({ msg, type: 'success', dur }),
  error:   (msg, dur) => _dispatch?.({ msg, type: 'error',   dur }),
  info:    (msg, dur) => _dispatch?.({ msg, type: 'info',    dur }),
  warn:    (msg, dur) => _dispatch?.({ msg, type: 'warn',    dur }),
};
