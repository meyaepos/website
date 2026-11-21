/**
 * 共用模組：雙軌掃碼引擎（藍牙 HID 條碼槍背景攔截 ＋ 手機鏡頭 1D/QR 解碼 ＋ 音效震動回饋）
 */
window.ScannerEngine = {
  html5Scanner: null,
  isCameraRunning: false,
  onScanCallback: null,

  // 藍牙條碼槍高速輸入緩衝區
  hidBuffer: '',
  hidLastKeyTime: 0,
  hidBound: false,

  // 防止同一張條碼在 1.5 秒內被鏡頭重複連掃
  lastScannedCode: '',
  lastScannedTime: 0,
  COOLDOWN_MS: 1500,

  /**
   * 綁定掃碼回呼函式，並啟動藍牙條碼槍背景監聽
   */
  init: function(callback) {
    this.onScanCallback = callback;
    if (!this.hidBound) {
      this._bindBluetoothHidListener();
      this.hidBound = true;
    }
  },

  /**
   * 藍牙條碼槍監聽：偵測極短間隔連續輸入 + Enter，店員免點輸入框即可連續刷條碼
   */
  _bindBluetoothHidListener: function() {
    document.addEventListener('keydown', e => {
      // 若游標停在表單輸入框內，交由該輸入框自行處理（避免干擾手動打字）
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const now = Date.now();
      if (now - this.hidLastKeyTime > 80) {
        this.hidBuffer = '';
      }
      this.hidLastKeyTime = now;

      if (e.key === 'Enter') {
        const code = this.hidBuffer.trim();
        this.hidBuffer = '';
        if (code.length >= 3) {
          e.preventDefault();
          this._emitCode(code, 'bluetooth');
        }
        return;
      }

      if (e.key && e.key.length === 1) {
        this.hidBuffer += e.key;
      }
    });
  },

  /**
   * 啟動手機後鏡頭掃碼（同時支援 Code 128、Code 39、EAN-13 一維條碼與 QR Code）
   */
  startCamera: async function(containerId, statusElId) {
    if (this.isCameraRunning) return true;
    const statusEl = statusElId ? document.getElementById(statusElId) : null;

    if (typeof Html5Qrcode === 'undefined') {
      if (statusEl) statusEl.textContent = '❌ 掃碼套件尚未載入，請確認網路連線。';
      return false;
    }

    try {
      if (statusEl) statusEl.textContent = '⏳ 正在開啟後置鏡頭...';
      this.html5Scanner = new Html5Qrcode(containerId);

      const formats = (typeof Html5QrcodeSupportedFormats !== 'undefined')
        ? [
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.QR_CODE
          ]
        : undefined;

      await this.html5Scanner.start(
        { facingMode: 'environment' },
        {
          fps: 12,
          // 橫長型掃描框，專為飾品長條碼貼紙最佳化
          qrbox: { width: 260, height: 110 },
          aspectRatio: 1.5,
          formatsToSupport: formats
        },
        decodedText => {
          this._emitCode(String(decodedText || '').trim(), 'camera');
        },
        () => {}
      );

      this.isCameraRunning = true;
      if (statusEl) statusEl.textContent = '🟢 鏡頭已就緒（請將條碼對準框線，亦可直接刷藍牙條碼槍）';
      return true;
    } catch (err) {
      if (statusEl) statusEl.textContent = '❌ 無法開啟相機：' + (err.message || err);
      return false;
    }
  },

  /**
   * 關閉手機鏡頭釋放資源
   */
  stopCamera: async function(statusElId) {
    if (!this.isCameraRunning || !this.html5Scanner) return;
    try {
      await this.html5Scanner.stop();
      await this.html5Scanner.clear();
    } catch (_) {}
    this.isCameraRunning = false;
    this.html5Scanner = null;
    const statusEl = statusElId ? document.getElementById(statusElId) : null;
    if (statusEl) statusEl.textContent = '📷 鏡頭已關閉（藍牙條碼槍仍持續待命中）';
  },

  /**
   * 手動輸入送出條碼
   */
  submitManualCode: function(code) {
    const clean = String(code || '').trim();
    if (!clean) return;
    this._emitCode(clean, 'manual');
  },

  _emitCode: function(code, source) {
    const now = Date.now();
    // 鏡頭連掃防抖；藍牙槍與手動輸入不受冷卻限制（可快速連刷同款多件）
    if (source === 'camera' && code === this.lastScannedCode && (now - this.lastScannedTime) < this.COOLDOWN_MS) {
      return;
    }
    this.lastScannedCode = code;
    this.lastScannedTime = now;

    if (typeof this.onScanCallback === 'function') {
      this.onScanCallback(code, source);
    }
  },

  /**
   * 現場作業音效與震動回饋（無需外部音檔，純 WebAudio 合成）
   * @param {'ok'|'error'|'complete'} type
   */
  feedback: function(type) {
    try {
      if (navigator.vibrate) {
        if (type === 'ok') navigator.vibrate(60);
        else if (type === 'complete') navigator.vibrate([80, 60, 120]);
        else navigator.vibrate([220, 80, 220]);
      }
    } catch (_) {}

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'ok') {
        osc.type = 'sine';
        osc.frequency.value = 1320;
        gain.gain.value = 0.12;
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      } else if (type === 'complete') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.09);
        gain.gain.value = 0.14;
        osc.start();
        osc.stop(ctx.currentTime + 0.22);
      } else {
        osc.type = 'sawtooth';
        osc.frequency.value = 210;
        gain.gain.value = 0.16;
        osc.start();
        osc.stop(ctx.currentTime + 0.28);
      }
    } catch (_) {}
  }
};
