'use strict'

import { ExponentialSineSweep } from './exponential_sine_sweep.js';
import { MeasurementAudioMessageType } from './measurement_audio.js';
import { Plot } from './plot.js';
import { getDataAsWav } from './wav_tools.js';

const SAMPLE_RATE_HZ = 48000.0;

const gumUseCheckbox = document.getElementById('gum-use');
const gdmUseCheckbox = document.getElementById('gdm-use');
const resultsTable = document.getElementById('results-table');

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

    let impulseResponseEstimatorInputIndex = 0;
    let impulseResponseEstimatorNumInputs = 0;
    if (gdmUseCheckbox.checked) {
        impulseResponseEstimatorNumInputs++;
    }
    if (gumUseCheckbox.checked) {
        impulseResponseEstimatorNumInputs++;
    }
    const impulseResponseEstimatorNode = new AudioWorkletNode(
        audioContext,
        'measurement-processor',
        {
            numberOfInputs: impulseResponseEstimatorNumInputs,
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
        gdmNode.connect(impulseResponseEstimatorNode, 0, impulseResponseEstimatorInputIndex);
        impulseResponseEstimatorInputIndex++;
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
        gumNode.connect(impulseResponseEstimatorNode, 0, impulseResponseEstimatorInputIndex);
        impulseResponseEstimatorInputIndex++;
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
            onMeasurement(event.data.measurement, audioContext.sampleRate);
        }
    };

    console.log('Start measurement');
    impulseResponseEstimatorNode.port.postMessage({
        type: MeasurementAudioMessageType.START_MEASUREMENT,
    });
}


function startMeasurement(onMeasurement) {
    console.log("Start measurement");
    initializeAudio(onMeasurement);
}

const p = new Plot(plotCanvas);

function publishResult(result) {
    const resultRow = resultsTable.insertRow(-1)

    const timestampCell = resultRow.insertCell(-1);
    const timestampText = document.createTextNode(result.timestamp);
    timestampCell.appendChild(timestampText);

    const latencyCell = resultRow.insertCell(-1);
    const latencyText = document.createTextNode(`${(result.latency * 1000).toFixed(3)}`);
    latencyCell.appendChild(latencyText);

    const gainCell = resultRow.insertCell(-1);
    const gainText = document.createTextNode(`${(result.gain).toFixed(1)}`);
    gainCell.appendChild(gainText);


    let measurementCell = resultRow.insertCell(-1);
    const measurementAnchor = document.createElement("a");
    measurementAnchor.appendChild(document.createTextNode("link"));
    measurementAnchor.href = result.measurementLink;
    measurementAnchor.setAttribute('download', 'measurement.wav');
    measurementCell.appendChild(measurementAnchor);


    let irCell = resultRow.insertCell(-1);
    const irAnchor = document.createElement("a");
    irAnchor.href = result.impulseResponseLink;
    irAnchor.setAttribute('download', 'impulse_response.wav');
    irAnchor.appendChild(document.createTextNode("link"));
    irCell.appendChild(irAnchor);
}

startElement.onclick = () => {
    startMeasurement((measurements, sampleRateHz) => {
        console.log(measurements);
        for (const measurement of measurements) {
            // p.plot(measurement);
            exponential_sine_sweep.linear_response(measurement).then(ir => {
                const measurementBlob = new Blob([getDataAsWav(sampleRateHz, 1, measurement)], { type: "audio/wav" });
                const irBlob = new Blob([getDataAsWav(sampleRateHz, 1, ir)], { type: "audio/wav" });
                p.vLine(0.2, "#0f0");
                p.draw(ir, sampleRateHz);
                let max = ir.reduce((a, b) => Math.max(Math.abs(a), Math.abs(b)), 0);
                console.log(`Max impulse response: ${max}`)
                let index_max = ir.findLastIndex(x => Math.abs(x) > 0.99 * max);
                let delay = index_max / sampleRateHz - 0.2;
                console.log(`Delay: ${delay} seconds`);
                p.vLine(delay + 0.2, "#00f");
                measuredResult.textContent = `Delay: ${delay * 1000} ms`;
                publishResult({
                    timestamp: Date.now(),
                    latency: delay,
                    gain: 20.0 * Math.log10(Math.abs(max)),
                    impulseResponseLink: URL.createObjectURL(irBlob),
                    measurementLink: URL.createObjectURL(measurementBlob),
                });
            });
        }
        audioContextLatency.textContent = `AudioContext baseLatency: ${audioContext.baseLatency} outputLatency: ${audioContext.outputLatency}`;
    });
};
