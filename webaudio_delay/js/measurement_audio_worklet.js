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

        this.numberOfInputs = options.numberOfInputs;
        this.preSilenceFrames = Math.trunc(0.2 * this.sampleRate);
        this.tailSilenceFrames = Math.trunc(4 * this.sampleRate);
        this.outputChannel = 0;
        this.inputChannel = 0;

        this.currentFrames = 0;
        this.measurementOnGoing = false;
        this.count = 0;

        this.recordingNumFrames = this.preSilenceFrames + this.excitationSignal.length + this.tailSilenceFrames;
        console.log(`Recording duration: ${this.recordingNumFrames} numberOfInputs: ${options.numberOfInputs}`);
        this.recording = [];
        for (let inputIndex = 0; inputIndex < options.numberOfInputs; ++inputIndex) {
            this.recording[inputIndex] = new Float32Array(this.recordingNumFrames);
        }

        this.port.onmessage = this.handle_message_.bind(this);
        console.log("finished constructor")
    }

    handle_message_(event) {
        if (event.data.type === MeasurementAudioMessageType.START_MEASUREMENT) {
            console.log('[Worker] START');
            this.currentFrames = 0;
            this.measurementOnGoing = true;
        }
    }

    log(msg) {
        console.log(msg);
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
        if (inputs === undefined) {
            return true;
        }
        for (let inputIndex = 0; inputIndex < this.numberOfInputs; ++inputIndex) {
            if (inputs[inputIndex] === undefined) {
                return true;
            }
        }

        const output = outputs[0][this.outputChannel];
        for (let n = 0; n < output.length; ++n) {
            if (this.currentFrames % 48000 === 0) {
                this.log(`One sec has passed: ${this.currentFrames} inputsSize: ${inputs.length} numberOfInputs: ${this.numberOfInputs}`);
            }
            if (this.currentFrames < this.recordingNumFrames) {
                for (let inputIndex = 0; inputIndex < this.numberOfInputs; ++inputIndex) {
                    this.recording[inputIndex][this.currentFrames] = inputs[inputIndex][this.inputChannel][n];
                }
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