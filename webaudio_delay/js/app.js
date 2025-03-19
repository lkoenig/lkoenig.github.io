'use strict'

import { ExponentialSineSweep } from './exponential_sine_sweep.js';
import { MeasurementAudioMessageType } from './measurement_audio.js';
import { Plot } from './plot.js';
import { getDataAsWav } from './wav_tools.js';

const SAMPLE_RATE_HZ = 48000.0;

const gumUseCheckbox = document.getElementById('gum-use');
const gdmUseCheckbox = document.getElementById('gdm-use');

const startElement = document.getElementById("measureButton");
const plotCanvas = document.getElementById("plotCanvas");
const downloadMeasurement = document.getElementById("downloadMeasurementLink");
downloadMeasurement.hidden = true;
const downloadLinearImpulseResponse = document.getElementById("downloadLinearImpulseResponseLink");
downloadLinearImpulseResponse.hidden = true;
const measuredResult = document.getElementById("measuredResult");
const audioContextLatency = document.getElementById("audioContextLatency");


let audioContext;

const exponential_sine_sweep = new ExponentialSineSweep(20.0 / SAMPLE_RATE_HZ * 2.0 * Math.PI, 0.5 * 2.0 * Math.PI, 2 ** 18);

async function initializeAudio(onMeasurement) {
    audioContext = new AudioContext({
        latencyHint: "interactive"
    });

    if (audioContext.state === "suspended") {
        console.log("Resume audio context");
        await audioContext.resume();
        console.log(`audio context sample rate: ${audioContext.sampleRate}`);
    }
    await audioContext.audioWorklet.addModule('js/measurement_audio_worklet.js');

    const impulseResponseEstimatorNode = new AudioWorkletNode(
        audioContext,
        'measurement-processor',
        {
            processorOptions: {
                excitationSignal: exponential_sine_sweep.sine_sweep
            }
        }
    );
    console.log('Connect stimulus to output of AudioContext');
    impulseResponseEstimatorNode.connect(audioContext.destination);


    let gdmInputStream;
    if (gdmUseCheckbox.checked) {
        console.log('Use getDisplayMedia');
        const gdmOptions = {
            video: true,
            audio: {
                echoCancellation: false,
                autoGainControl: false,
                noiseSuppression: false,
                suppressLocalAudioPlayback: false,
            },
            systemAudio: 'include',
            preferCurrentTab: false,
            selfBrowserSurface: 'include',
            surfaceSwitching: 'exclude',
            monitorTypeSurfaces: 'include',

        };
        gdmInputStream = await navigator.mediaDevices.getDisplayMedia(gdmOptions);
        console.log(gdmInputStream);
        const gdmNode = new MediaStreamAudioSourceNode(audioContext, { mediaStream: gdmInputStream });
        gdmNode.connect(impulseResponseEstimatorNode);
    }

    let gumInputStream;
    if (gumUseCheckbox.checked) {
        console.log('Use getUserMedia');
        // Get user's microphone and connect it to the AudioContext.
        gumInputStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: { exact: false },
                autoGainControl: { exact: false },
                noiseSuppression: { exact: false },
                latency: 0
            }
        });

        const gumNode = new MediaStreamAudioSourceNode(audioContext, { mediaStream: gumInputStream });
        gumNode.connect(impulseResponseEstimatorNode);
    }

    console.log("Register logger for the audio worklet");
    impulseResponseEstimatorNode.port.onmessage = (event) => {
        if (event.data.type === MeasurementAudioMessageType.LOG) {
            console.log("[Worklet]: " + event.data.message);
        } else if (event.data.type === MeasurementAudioMessageType.MEASUREMENT_DONE) {
            console.log("Measurement is done");
            if (gumInputStream !== undefined) {
                gumInputStream.getTracks().forEach(function (track) {
                    track.stop();
                });
            }
            if (gdmInputStream !== undefined) {
                gdmInputStream.getTracks().forEach(function (track) {
                    track.stop();
                });
            }
            audioContext.suspend();
            onMeasurement(event.data.measurement);
        }
    };

    console.log('Start measurment');
    impulseResponseEstimatorNode.port.postMessage({
        type: MeasurementAudioMessageType.START_MEASUREMENT,
    });
}


function startMeasurement(onMeasurement) {
    console.log("Start measurement");
    initializeAudio(onMeasurement);
}

const p = new Plot(plotCanvas);

startElement.onclick = () => {
    startMeasurement(measurement => {
        const blob = new Blob([getDataAsWav(audioContext.sampleRate, 1, measurement)], { type: "audio/wav" });
        downloadMeasurement.href = URL.createObjectURL(blob)
        downloadMeasurement.hidden = false;
        downloadMeasurement.setAttribute('download', 'measurement.wav')
        // p.plot(measurement);
        exponential_sine_sweep.linear_response(measurement).then(ir => {
            const blob = new Blob([getDataAsWav(audioContext.sampleRate, 1, ir)], { type: "audio/wav" });
            downloadLinearImpulseResponse.href = URL.createObjectURL(blob)
            downloadLinearImpulseResponse.hidden = false;
            downloadLinearImpulseResponse.setAttribute('download', 'impulse_response.wav');
            p.vLine(0.2, "#0f0");
            p.draw(ir, audioContext.sampleRate);
            let max = ir.reduce((a, b) => Math.max(Math.abs(a), Math.abs(b)), 0);
            console.log(`Max impulse response: ${max}`)
            let index_max = ir.findLastIndex(x => Math.abs(x) > 0.99 * max);
            let delay = index_max / audioContext.sampleRate - 0.2;
            console.log(`Delay: ${delay} seconds`);
            p.vLine(delay + 0.2, "#00f");
            measuredResult.textContent = `Delay: ${delay * 1000} ms`;
            audioContext = undefined;
        });
        audioContextLatency.textContent = `AudioContext baseLatency: ${audioContext.baseLatency} outputLatency: ${audioContext.outputLatency}`;
    });
};
