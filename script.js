let audioCtx;
let midiAccess = null;
let isPlaying = false;
let masterGain, eqNodes = [], delay1, delay2, reverbNode, synth1ReverbGain, synth2ReverbGain;

// Sequencer State

// For Discreet Music, a "step" here could be a quarter note. 
// e.g. 12 bars in 4/4 = 48 steps. 14 bars = 56 steps.
let seq1Steps = 48; 
let seq2Steps = 56;
let currentStep1 = 0;
let currentStep2 = 0;
let nextNoteTime = 0.0;
let lookahead = 25.0; // ms
let scheduleAheadTime = 0.1; // s
let tempo = 60.0;
let timerID;

// Basic Pentatonic Scale for generative ambient
const scale = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86].reverse();

// UI State arrays (true/false for active notes)
const seq1Data = Array.from({length: 12}, () => new Array(128).fill(false));
const seq2Data = Array.from({length: 12}, () => new Array(128).fill(false));

// 10-Band EQ Presets
const eqPresets = [
    { name: "Flat", values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { name: "Bass Boost", values: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
    { name: "Treble Boost", values: [0, 0, 0, 0, 0, 1, 3, 5, 6, 7] },
    { name: "Mid Scoop", values: [3, 2, 0, -4, -5, -4, 0, 2, 3, 3] },
    { name: "Warm Ambient", values: [4, 3, 2, 1, 0, -1, -2, -3, -4, -5] },
    { name: "Bright / Air", values: [-4, -3, -2, -1, 0, 2, 4, 6, 7, 8] },
    { name: "Club / Loudness", values: [5, 4, 2, 0, -2, 0, 2, 4, 5, 4] },
    { name: "Low-Pass Felt", values: [2, 2, 1, 0, -2, -5, -8, -10, -12, -12] }
];
let currentPresetIndex = 0;

document.addEventListener('DOMContentLoaded', () => {
    initUI();
    
    document.getElementById('play-btn').addEventListener('click', async () => {
        if (!audioCtx) await initAudioAndMidi();
        
        isPlaying = !isPlaying;
        if (isPlaying) {
            if(audioCtx.state === 'suspended') audioCtx.resume();
            nextNoteTime = audioCtx.currentTime + 0.05;
            scheduler();
        } else {
            clearTimeout(timerID);
        }
    });

    document.getElementById('bpm-input').addEventListener('input', (e) => tempo = e.target.value);
    document.getElementById('seq1-length').addEventListener('change', (e) => {
        seq1Steps = parseInt(e.target.value) * 4;  // Assuming 4 beats per bar
    });
    document.getElementById('seq2-length').addEventListener('change', (e) => {
        seq2Steps = parseInt(e.target.value) * 4;
    });
});

async function initAudioAndMidi() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Master Gain
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.5;

    // --- REVERB SETUP ---
    reverbNode = audioCtx.createConvolver();
    reverbNode.buffer = createImpulseResponse(audioCtx, 3.0, 2.0); // 3 sec ambient hall tail

    synth1ReverbGain = audioCtx.createGain();
    synth2ReverbGain = audioCtx.createGain();

    synth1ReverbGain.gain.value = parseFloat(document.getElementById('s1-rev').value);
    synth2ReverbGain.gain.value = parseFloat(document.getElementById('s2-rev').value);

    // Reverb send listeners
    document.getElementById('s1-rev').addEventListener('input', (e) => {
        if (synth1ReverbGain) synth1ReverbGain.gain.setValueAtTime(e.target.value, audioCtx.currentTime);
    });
    document.getElementById('s2-rev').addEventListener('input', (e) => {
        if (synth2ReverbGain) synth2ReverbGain.gain.setValueAtTime(e.target.value, audioCtx.currentTime);
    });

    // Route Reverb to Master
    synth1ReverbGain.connect(reverbNode);
    synth2ReverbGain.connect(reverbNode);
    reverbNode.connect(masterGain);

    // --- 10-BAND EQ SETUP ---
    const eqFrequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    let lastNode = masterGain;
    
    eqFrequencies.forEach((freq, i) => {
        const filter = audioCtx.createBiquadFilter();
        filter.type = "peaking";
        filter.frequency.value = freq;
        filter.Q.value = 1.41;

        // Initialize node gain from slider UI value
        const slider = document.getElementById(`eq-band-${i}`);
        filter.gain.value = slider ? parseFloat(slider.value) : 0;

        lastNode.connect(filter);
        lastNode = filter;
        eqNodes.push(filter);

        // Link EQ UI
        if(slider) {
            slider.addEventListener('input', (e) => filter.gain.value = parseFloat(e.target.value));
        }
    });

    // --- DELAYS SETUP & EVENT LISTENERS ---
    // Delay 1: 3.0s initial default
    delay1 = createDelayEffect(lastNode, 3.0, 0.4, 2000, 0.3);
    // Delay 2: 6.0s max delay
    delay2 = createDelayEffect(delay1.output, 6.0, 0.6, 1500, 0.2);
    delay2.output.connect(audioCtx.destination);

    bindDelayControls('delay1', delay1);
    bindDelayControls('delay2', delay2);

    // MIDI Setup
    try {
        midiAccess = await navigator.requestMIDIAccess();
        console.log("Web MIDI API connected!");
    } catch (err) {
        console.warn("MIDI not supported or access denied.", err);
    }
}

// Procedural impulse response generator for ambient reverb
function createImpulseResponse(ctx, duration, decay) {
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * duration;
    const impulse = ctx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
        const n = i;
        left[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
        right[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
    }
    return impulse;
}

function createDelayEffect(inputNode, time, feedback, cutoff, mix) {
    const delayNode = audioCtx.createDelay(10.0); // Allow max 10s buffer space
    const feedbackGain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    const dryGain = audioCtx.createGain();
    const wetGain = audioCtx.createGain();
    const outputNode = audioCtx.createGain();

    delayNode.delayTime.value = time;
    feedbackGain.gain.value = feedback;
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;

    dryGain.gain.value = 1 - mix;
    wetGain.gain.value = mix;

    // Routing
    inputNode.connect(dryGain);
    dryGain.connect(outputNode);

    inputNode.connect(delayNode);
    delayNode.connect(filter);
    filter.connect(feedbackGain);
    feedbackGain.connect(delayNode);

    filter.connect(wetGain);
    wetGain.connect(outputNode);

    return {
        input: inputNode,
        output: outputNode,
        setTime: (val) => delayNode.delayTime.setValueAtTime(val, audioCtx.currentTime),
        setFeedback: (val) => feedbackGain.gain.setValueAtTime(val, audioCtx.currentTime),
        setFilter: (val) => filter.frequency.setValueAtTime(val, audioCtx.currentTime),
        setMix: (val) => {
            dryGain.gain.setValueAtTime(1 - val, audioCtx.currentTime);
            wetGain.gain.setValueAtTime(val, audioCtx.currentTime);
        }
    };
}

function bindDelayControls(containerId, delayEffect) {
    const container = document.getElementById(containerId);
    
    container.querySelector('.delay-time').addEventListener('input', (e) => {
        delayEffect.setTime(parseFloat(e.target.value));
    });
    container.querySelector('.delay-fback').addEventListener('input', (e) => {
        delayEffect.setFeedback(parseFloat(e.target.value));
    });
    container.querySelector('.delay-filter').addEventListener('input', (e) => {
        delayEffect.setFilter(parseFloat(e.target.value));
    });
    container.querySelector('.delay-mix').addEventListener('input', (e) => {
        delayEffect.setMix(parseFloat(e.target.value));
    });
}

// Applies preset gain values to sliders and Web Audio nodes
function applyEqPreset(index) {
    currentPresetIndex = index;
    const preset = eqPresets[index];
    const nameEl = document.getElementById('eq-preset-name');
    if (nameEl) nameEl.textContent = preset.name;

    preset.values.forEach((val, i) => {
        const slider = document.getElementById(`eq-band-${i}`);
        if (slider) slider.value = val;
        
        if (eqNodes[i]) {
            if (audioCtx) {
                eqNodes[i].gain.setValueAtTime(val, audioCtx.currentTime);
            } else {
                eqNodes[i].gain.value = val;
            }
        }
    });
}

// Generates the visual piano roll grid
function initUI() {
    createPianoRoll('roll1', seq1Data, 64); // Render 64 steps visually
    createPianoRoll('roll2', seq2Data, 64);

    // Inject EQ sliders
    const eqContainer = document.getElementById('eq-sliders');
    for(let i = 0; i < 10; i++) {
        const wrap = document.createElement('div');
        wrap.className = 'eq-slider-container';
        wrap.innerHTML = `<input type="range" orient="vertical" id="eq-band-${i}" min="-12" max="12" step="0.1" value="0">`;
        eqContainer.appendChild(wrap);
    }

    // Bind EQ preset buttons
    document.getElementById('eq-preset-prev').addEventListener('click', () => {
        const newIndex = (currentPresetIndex - 1 + eqPresets.length) % eqPresets.length;
        applyEqPreset(newIndex);
    });
    document.getElementById('eq-preset-next').addEventListener('click', () => {
        const newIndex = (currentPresetIndex + 1) % eqPresets.length;
        applyEqPreset(newIndex);
    });
}

function createPianoRoll(containerId, dataArray, visualSteps) {
    const container = document.getElementById(containerId);
    for (let row = 0; row < 12; row++) {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'pr-row';
        for (let col = 0; col < visualSteps; col++) {
            const cell = document.createElement('div');
            cell.className = 'pr-cell';
            cell.id = `${containerId}-r${row}-c${col}`;
            cell.addEventListener('click', () => {
                dataArray[row][col] = !dataArray[row][col];
                cell.classList.toggle('active', dataArray[row][col]);
            });
            rowDiv.appendChild(cell);
        }
        container.appendChild(rowDiv);
    }
}

// Scheduling Logic - The Core of the Discreet Phasing
function nextNote() {
    const secondsPerBeat = 60.0 / tempo;
    nextNoteTime += secondsPerBeat;
    
    // Independent loop counters
    currentStep1++;
    if (currentStep1 >= seq1Steps) currentStep1 = 0;
    
    currentStep2++;
    if (currentStep2 >= seq2Steps) currentStep2 = 0;
}

function scheduleNote(step1, step2, time) {
     // Synth 1 check
    for (let row = 0; row < 12; row++) {
        if (seq1Data[row][step1]) playSynthAndMIDI(1, scale[row], time);
    }
    
    // Synth 2 check
    for (let row = 0; row < 12; row++) {
        if (seq2Data[row][step2]) playSynthAndMIDI(2, scale[row], time);
    }

    // UI Updates (Request Animation Frame to sync with visual refresh)
    requestAnimationFrame(() => {
        document.querySelectorAll('.playing').forEach(el => el.classList.remove('playing'));
        for(let r=0; r<12; r++) {
            const cell1 = document.getElementById(`roll1-r${r}-c${step1}`);
            if(cell1) cell1.classList.add('playing');
            
            const cell2 = document.getElementById(`roll2-r${r}-c${step2}`);
            if(cell2) cell2.classList.add('playing');
        }
    });
}

function scheduler() {
    while (nextNoteTime < audioCtx.currentTime + scheduleAheadTime) {
        scheduleNote(currentStep1, currentStep2, nextNoteTime);
        nextNote();
    }
    timerID = setTimeout(scheduler, lookahead);
}

 // 1. Play Internal Web Audio Synth
function playSynthAndMIDI(synthNum, midiNote, time) {
    const wave = document.getElementById(`s${synthNum}-wave`).value;
    const atk = parseFloat(document.getElementById(`s${synthNum}-atk`).value);
    const dec = parseFloat(document.getElementById(`s${synthNum}-dec`).value);
    const cut = parseFloat(document.getElementById(`s${synthNum}-cut`).value);
    const res = parseFloat(document.getElementById(`s${synthNum}-res`).value);
    const trill = parseFloat(document.getElementById(`s${synthNum}-trill`).value);
    const trillKey = document.getElementById(`s${synthNum}-trill-key`).checked;
    
    const osc = audioCtx.createOscillator();
    const vca = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    
    const baseFreq = 440 * Math.pow(2, (midiNote - 69) / 12); // MIDI to Hz
    osc.type = wave;
    osc.frequency.setValueAtTime(baseFreq, time);

    // Trill modulation implementation (LFO square pitch modulation)
    if (trill > 0) {
        const lfo = audioCtx.createOscillator();
        const lfoGain = audioCtx.createGain();
        
        let rate = 6 + (trill / 10); // Base trill speed (6 Hz - 16 Hz)
        if (trillKey) {
            rate *= (midiNote / 60); // Trill key follow scales speed with note pitch
        }
        
        lfo.type = 'square';
        lfo.frequency.setValueAtTime(rate, time);
        
        // Depth scales pitch up to 2 semitones
        const semitoneOffset = (trill / 100) * 2;
        const freqOffset = baseFreq * (Math.pow(2, semitoneOffset / 12) - 1);
        lfoGain.gain.setValueAtTime(freqOffset, time);
        
        lfo.connect(osc.frequency);
        lfo.start(time);
        lfo.stop(time + atk + dec);
    }
    
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cut, time);
    filter.Q.setValueAtTime(res, time); 
    
    // Envelope
    vca.gain.setValueAtTime(0, time);
    vca.gain.linearRampToValueAtTime(0.3, time + atk); // Note On
    vca.gain.setTargetAtTime(0, time + atk, dec / 3); // Note Off Tail

    osc.connect(filter);
    filter.connect(vca);

    // Route dry to master gain, wet send to reverb bus
    vca.connect(masterGain);
    if (synthNum === 1 && synth1ReverbGain) vca.connect(synth1ReverbGain);
    if (synthNum === 2 && synth2ReverbGain) vca.connect(synth2ReverbGain);
    
    osc.start(time);
    osc.stop(time + atk + dec);

    // Web MIDI Output / Transmit Web MIDI
    if (midiAccess) {
        const midiChannel = parseInt(document.getElementById(`s${synthNum}-midi`).value) - 1;
        const noteOnMessage = [0x90 + midiChannel, midiNote, 0x7f]; 
        const noteOffMessage = [0x80 + midiChannel, midiNote, 0x00];
        const timeToSchedule = performance.now() + ((time - audioCtx.currentTime) * 1000);
        
        for (let output of midiAccess.outputs.values()) {
            output.send(noteOnMessage, timeToSchedule);
            output.send(noteOffMessage, timeToSchedule + (atk * 1000));
        }
    }
}