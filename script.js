// --- Web Audio & MIDI Core Nodes ---
let audioCtx;
let midiAccess = null;
let isPlaying = false;
let masterGain, eqNodes = [], delay1, delay2, reverbNode, synth1ReverbGain, synth2ReverbGain;

// --- Sequencer State & Web Audio Timing Parameters ---
let seq1Steps = 48; // Default 12 bars * 4 steps
let seq2Steps = 56; // Default 14 bars * 4 steps
let currentStep1 = 0;
let currentStep2 = 0;
let nextNoteTime = 0.0;
let lookahead = 25.0; // Scheduler call frequency (ms)
let scheduleAheadTime = 0.1; // Audio scheduling window ahead (s)
let tempo = 60.0;
let timerID;

// Basic Pentatonic Scale (MIDI Pitch Values) for generative phase interplay
const scale = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86].reverse();

// Sequencer Grid State Storage (12 rows x 128 max columns)
const seq1Data = Array.from({length: 12}, () => new Array(128).fill(false));
const seq2Data = Array.from({length: 12}, () => new Array(128).fill(false));

// --- 10-Band Graphic EQ Presets ---
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
let currentEqPresetIndex = 0;

// --- Delay FX Presets (Slapback to Long Ambient Repeats) ---
const delayPresets = [
    { name: "Slapback (0.15s)", time: 0.15, fback: 0.25, filter: 4000, mix: 0.4 },
    { name: "Short Doubler (0.35s)", time: 0.35, fback: 0.35, filter: 3500, mix: 0.35 },
    { name: "Rhythmic Echo (1.25s)", time: 1.25, fback: 0.50, filter: 2500, mix: 0.4 },
    { name: "Medium Echo (3s)", time: 3.00, fback: 0.40, filter: 2000, mix: 0.3 },
    { name: "Ambient Space (4.2s)", time: 4.20, fback: 0.65, filter: 1200, mix: 0.45 },
    { name: "Dark Dub Tape (2.5s)", time: 2.50, fback: 0.75, filter: 600, mix: 0.5 },
    { name: "Endless Vault (5.8s)", time: 5.80, fback: 0.85, filter: 1000, mix: 0.5 },
    { name: "Long Drone (6s)", time: 6.00, fback: 0.60, filter: 1500, mix: 0.2 }
];
let delay1PresetIndex = 3; // Default: Medium Echo (3s)
let delay2PresetIndex = 7; // Default: Long Drone (6s)

// --- Lifecycle & Control Event Handlers ---
document.addEventListener('DOMContentLoaded', () => {
    initUI();
    
    // Play/Pause transport toggle with AudioContext unlocking
    document.getElementById('play-btn').addEventListener('click', async () => {
        if (!audioCtx) await initAudioAndMidi();
        
        isPlaying = !isPlaying;
        if (isPlaying) {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            nextNoteTime = audioCtx.currentTime + 0.05;
            scheduler();
        } else {
            clearTimeout(timerID);
        }
    });

    // Tempo & Sequence length dynamic updates
    document.getElementById('bpm-input').addEventListener('input', (e) => tempo = e.target.value);
    document.getElementById('seq1-length').addEventListener('change', (e) => {
        seq1Steps = parseInt(e.target.value) * 4;
    });
    document.getElementById('seq2-length').addEventListener('change', (e) => {
        seq2Steps = parseInt(e.target.value) * 4;
    });
});

// --- Audio Engine Initialization ---
async function initAudioAndMidi() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Master Output Gain
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.5;

    // Convolver Reverb Setup
    reverbNode = audioCtx.createConvolver();
    reverbNode.buffer = createImpulseResponse(audioCtx, 3.0, 2.0);

    synth1ReverbGain = audioCtx.createGain();
    synth2ReverbGain = audioCtx.createGain();

    synth1ReverbGain.gain.value = parseFloat(document.getElementById('s1-rev').value);
    synth2ReverbGain.gain.value = parseFloat(document.getElementById('s2-rev').value);

    document.getElementById('s1-rev').addEventListener('input', (e) => {
        if (synth1ReverbGain) synth1ReverbGain.gain.setValueAtTime(e.target.value, audioCtx.currentTime);
    });
    document.getElementById('s2-rev').addEventListener('input', (e) => {
        if (synth2ReverbGain) synth2ReverbGain.gain.setValueAtTime(e.target.value, audioCtx.currentTime);
    });

    synth1ReverbGain.connect(reverbNode);
    synth2ReverbGain.connect(reverbNode);
    reverbNode.connect(masterGain);

    // 10-Band Graphic Equalizer Chain
    const eqFrequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    let lastNode = masterGain;
    
    eqFrequencies.forEach((freq, i) => {
        const filter = audioCtx.createBiquadFilter();
        filter.type = "peaking";
        filter.frequency.value = freq;
        filter.Q.value = 1.41;

        const slider = document.getElementById(`eq-band-${i}`);
        filter.gain.value = slider ? parseFloat(slider.value) : 0;

        lastNode.connect(filter);
        lastNode = filter;
        eqNodes.push(filter);

        if (slider) {
            slider.addEventListener('input', (e) => filter.gain.value = parseFloat(e.target.value));
        }
    });

    // Serial Delay Modules (EQ Output -> Delay 1 -> Delay 2 -> Destination)
    const d1State = delayPresets[delay1PresetIndex];
    const d2State = delayPresets[delay2PresetIndex];

    delay1 = createDelayEffect(lastNode, d1State.time, d1State.fback, d1State.filter, d1State.mix);
    delay2 = createDelayEffect(delay1.output, d2State.time, d2State.fback, d2State.filter, d2State.mix);
    delay2.output.connect(audioCtx.destination);

    bindDelayControls('delay1', delay1);
    bindDelayControls('delay2', delay2);

    // Web MIDI Initialization
    try {
        midiAccess = await navigator.requestMIDIAccess();
        console.log("Web MIDI API connected successfully.");
    } catch (err) {
        console.warn("MIDI access denied or unsupported in this browser.", err);
    }
}

// Algorithmic Synthetic Reverb Impulse Response Generator
function createImpulseResponse(ctx, duration, decay) {
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * duration;
    const impulse = ctx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
        left[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
        right[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    return impulse;
}

// Factory Function for Custom Filtered Delay Lines
function createDelayEffect(inputNode, time, feedback, cutoff, mix) {
    const delayNode = audioCtx.createDelay(10.0);
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

    // Routing: Input splits into Dry Output and Wet Delay Feedback Loop
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

// Bind UI Input Sliders to a Delay Effect Object
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

// Apply selected EQ preset values to sliders & audio nodes
function applyEqPreset(index) {
    currentEqPresetIndex = index;
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

// Apply selected Delay preset values to UI sliders & audio nodes
function applyDelayPreset(delayNum, index) {
    const preset = delayPresets[index];
    const container = document.getElementById(`delay${delayNum}`);
    const nameEl = document.getElementById(`delay${delayNum}-preset-name`);
    const delayEffect = delayNum === 1 ? delay1 : delay2;

    if (delayNum === 1) delay1PresetIndex = index;
    if (delayNum === 2) delay2PresetIndex = index;

    if (nameEl) nameEl.textContent = preset.name;

    if (container) {
        container.querySelector('.delay-time').value = preset.time;
        container.querySelector('.delay-fback').value = preset.fback;
        container.querySelector('.delay-filter').value = preset.filter;
        container.querySelector('.delay-mix').value = preset.mix;
    }

    if (delayEffect && audioCtx) {
        delayEffect.setTime(preset.time);
        delayEffect.setFeedback(preset.fback);
        delayEffect.setFilter(preset.filter);
        delayEffect.setMix(preset.mix);
    }
}

// Construct DOM Components and Event Wiring
function initUI() {
    createPianoRoll('roll1', seq1Data, 64);
    createPianoRoll('roll2', seq2Data, 64);

    // Build vertical EQ Sliders dynamically
    const eqContainer = document.getElementById('eq-sliders');
    for (let i = 0; i < 10; i++) {
        const wrap = document.createElement('div');
        wrap.className = 'eq-slider-container';
        wrap.innerHTML = `<input type="range" orient="vertical" id="eq-band-${i}" min="-12" max="12" step="0.1" value="0">`;
        eqContainer.appendChild(wrap);
    }

    // EQ Selector Listeners
    document.getElementById('eq-preset-prev').addEventListener('click', () => {
        const newIndex = (currentEqPresetIndex - 1 + eqPresets.length) % eqPresets.length;
        applyEqPreset(newIndex);
    });
    document.getElementById('eq-preset-next').addEventListener('click', () => {
        const newIndex = (currentEqPresetIndex + 1) % eqPresets.length;
        applyEqPreset(newIndex);
    });

    // Delay 1 Selector Listeners
    document.getElementById('delay1-preset-prev').addEventListener('click', () => {
        const newIndex = (delay1PresetIndex - 1 + delayPresets.length) % delayPresets.length;
        applyDelayPreset(1, newIndex);
    });
    document.getElementById('delay1-preset-next').addEventListener('click', () => {
        const newIndex = (delay1PresetIndex + 1) % delayPresets.length;
        applyDelayPreset(1, newIndex);
    });

    // Delay 2 Selector Listeners
    document.getElementById('delay2-preset-prev').addEventListener('click', () => {
        const newIndex = (delay2PresetIndex - 1 + delayPresets.length) % delayPresets.length;
        applyDelayPreset(2, newIndex);
    });
    document.getElementById('delay2-preset-next').addEventListener('click', () => {
        const newIndex = (delay2PresetIndex + 1) % delayPresets.length;
        applyDelayPreset(2, newIndex);
    });
}

// Render Interactive Grid Cells for Sequencers
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

// Advance Beat Counter in Web Audio Time Space
function nextNote() {
    const secondsPerBeat = 60.0 / tempo;
    nextNoteTime += secondsPerBeat;
    
    currentStep1++;
    if (currentStep1 >= seq1Steps) currentStep1 = 0;
    
    currentStep2++;
    if (currentStep2 >= seq2Steps) currentStep2 = 0;
}

// Evaluate Grid State & Schedule Audio Synthesizer Triggers
function scheduleNote(step1, step2, time) {
    for (let row = 0; row < 12; row++) {
        if (seq1Data[row][step1]) playSynthAndMIDI(1, scale[row], time);
    }
    
    for (let row = 0; row < 12; row++) {
        if (seq2Data[row][step2]) playSynthAndMIDI(2, scale[row], time);
    }

    // Update Visual Sequence Head Position
    requestAnimationFrame(() => {
        document.querySelectorAll('.playing').forEach(el => el.classList.remove('playing'));
        for (let r = 0; r < 12; r++) {
            const cell1 = document.getElementById(`roll1-r${r}-c${step1}`);
            if (cell1) cell1.classList.add('playing');
            
            const cell2 = document.getElementById(`roll2-r${r}-c${step2}`);
            if (cell2) cell2.classList.add('playing');
        }
    });
}

// Lookahead Timing Loop for Precise Audio Context Scheduling
function scheduler() {
    while (nextNoteTime < audioCtx.currentTime + scheduleAheadTime) {
        scheduleNote(currentStep1, currentStep2, nextNoteTime);
        nextNote();
    }
    timerID = setTimeout(scheduler, lookahead);
}

// Synthesize Voice & Output Web MIDI Signal
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
    
    // Pitch & Oscillator Setup
    const baseFreq = 440 * Math.pow(2, (midiNote - 69) / 12);
    osc.type = wave;
    osc.frequency.setValueAtTime(baseFreq, time);

    // LFO Trill Modulation Engine
    if (trill > 0) {
        const lfo = audioCtx.createOscillator();
        const lfoGain = audioCtx.createGain();
        
        let rate = 6 + (trill / 10);
        if (trillKey) rate *= (midiNote / 60);
        
        lfo.type = 'square';
        lfo.frequency.setValueAtTime(rate, time);
        
        const semitoneOffset = (trill / 100) * 2;
        const freqOffset = baseFreq * (Math.pow(2, semitoneOffset / 12) - 1);
        lfoGain.gain.setValueAtTime(freqOffset, time);
        
        lfo.connect(osc.frequency);
        lfo.start(time);
        lfo.stop(time + atk + dec);
    }
    
    // Filter Shaping
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cut, time);
    filter.Q.setValueAtTime(res, time); 
    
    // Envelope (VCA) Target Curves
    vca.gain.setValueAtTime(0, time);
    vca.gain.linearRampToValueAtTime(0.3, time + atk);
    vca.gain.setTargetAtTime(0, time + atk, dec / 3);

    // Signal Routing
    osc.connect(filter);
    filter.connect(vca);
    vca.connect(masterGain);

    if (synthNum === 1 && synth1ReverbGain) vca.connect(synth1ReverbGain);
    if (synthNum === 2 && synth2ReverbGain) vca.connect(synth2ReverbGain);
    
    osc.start(time);
    osc.stop(time + atk + dec);

    // Transmit Web MIDI Messages if active
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