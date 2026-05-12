/**
 * 🎤 WhatsHybrid - Voice Recorder
 * Sistema de gravação de áudio para treinamento de IA
 * @version 7.9.13
 */
(function() {
  'use strict';

  class VoiceRecorder {
    constructor(options = {}) {
      this.mediaRecorder = null;
      this.audioChunks = [];
      this.stream = null;
      this.isRecording = false;
      this.startTime = null;
      this.duration = 0;
      this.maxDuration = options.maxDuration || 60000;
      this.onStop = options.onStop || null;
      this.onError = options.onError || null;
      this.onDurationUpdate = options.onDurationUpdate || null;
      this.durationInterval = null;
    }

    static isSupported() {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    }

    _getSupportedMimeType() {
      const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'];
      for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) return type;
      }
      return '';
    }

    async start() {
      if (this.isRecording) return false;
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
        });
        const mimeType = this._getSupportedMimeType();
        this.mediaRecorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : {});
        this.audioChunks = [];

        this.mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) this.audioChunks.push(e.data);
        };

        this.mediaRecorder.onstop = () => this._handleStop();
        this.mediaRecorder.onerror = (e) => this.onError?.(e.error);

        this.mediaRecorder.start(1000);
        this.isRecording = true;
        this.startTime = Date.now();
        this._startTimer();
        return true;
      } catch (error) {
        this.onError?.(error);
        return false;
      }
    }

    stop() {
      if (!this.isRecording) return;
      this._stopTimer();
      if (this.mediaRecorder?.state !== 'inactive') this.mediaRecorder.stop();
      if (this.stream) {
        this.stream.getTracks().forEach(t => t.stop());
        this.stream = null;
      }
      this.isRecording = false;
    }

    cancel() {
      this._stopTimer();
      if (this.mediaRecorder?.state !== 'inactive') this.mediaRecorder.stop();
      if (this.stream) {
        this.stream.getTracks().forEach(t => t.stop());
        this.stream = null;
      }
      this.audioChunks = [];
      this.isRecording = false;
    }

    _handleStop() {
      const mimeType = this._getSupportedMimeType() || 'audio/webm';
      const blob = new Blob(this.audioChunks, { type: mimeType });
      this.onStop?.({ blob, duration: this.duration, mimeType, url: URL.createObjectURL(blob) });
    }

    _startTimer() {
      this.durationInterval = setInterval(() => {
        this.duration = Date.now() - this.startTime;
        this.onDurationUpdate?.(this.duration);
        if (this.duration >= this.maxDuration) this.stop();
      }, 100);
    }

    _stopTimer() {
      if (this.durationInterval) {
        clearInterval(this.durationInterval);
        this.durationInterval = null;
      }
    }

    static async blobToBase64(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
  }

  window.WHLVoiceRecorder = VoiceRecorder;
})();
