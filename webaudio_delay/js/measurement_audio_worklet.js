import { MeasurementAudioMessageType } from './measurement_audio.js';

class MeasurementProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();

        this.sampleRate = sampleRate;
        this.excitationSignal = Array(0);

        if (options && options.processorOptions) {
            const {
                excitationSignal,
            } = options.processorOptions;

            this.excitationSignal = excitationSignal;
        }

        console.log(options);

        this.preSilenceFrames = Math.trunc(0.2 * this.sampleRate);
        this.tailSilenceFrames = Math.trunc(4 * this.sampleRate);
        this.outputChannel = 0;
        this.inputChannel = 0;

        this.currentFrames = 0;
        this.measurementOnGoing = false;
        this.count = 0;

        console.log(`Recording duration: ${this.preSilenceFrames} + ${this.excitationSignal.length} + ${this.tailSilenceFrames}`);
        this.recording = new Float32Array(this.preSilenceFrames + this.excitationSignal.length + this.tailSilenceFrames);
        this.once = 0;

        this.port.onmessage = this.handle_message_.bind(this);
    }

    handle_message_(event) {
        console.log("[MeasurementProcessor] got " + event);
        if (event.data.type === MeasurementAudioMessageType.START_MEASUREMENT) {
            this.currentFrames = 0;
            this.measurementOnGoing = true;
        }
    }

    log(msg) {
        this.port.postMessage({
            type: MeasurementAudioMessageType.LOG,
            message: msg,
        });
    }

    measurement_done() {
        this.port.postMessage({
            type: MeasurementAudioMessageType.MEASUREMENT_DONE,
            measurement: this.recording,
        });
    }

    process(inputs, outputs) {
        if (this.measurementOnGoing === false) {
            return true;
        }
        const output = outputs[0][this.outputChannel];
        const input = inputs[0][this.inputChannel];
        if (input === undefined) {
            return true;
        }
        for (let n = 0; n < output.length; ++n) {
            if (this.currentFrames % 48000 === 0) {
                this.log(`One sec has passed: ${this.currentFrames}`);
            }
            if (this.currentFrames < this.recording.length) {
                this.recording[this.currentFrames] = input[n];
            } else {
                this.measurementOnGoing = false;
                this.measurement_done();
                return false;
            }
            this.currentFrames += 1;

            if (this.currentFrames < this.preSilenceFrames) {
                continue;
            }
            const excitationFrame = this.currentFrames - this.preSilenceFrames;
            if (excitationFrame >= 0 && excitationFrame < this.excitationSignal.length) {
                output[n] = this.excitationSignal[excitationFrame];
            }
        }
        return true;

    }

};


registerProcessor('measurement-processor', MeasurementProcessor);