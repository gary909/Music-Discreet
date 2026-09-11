// --- Web Audio & MIDI Core Nodes ---
let audioCtx;
let midiAccess = null;
let isPlaying = false;
let masterGain, eqNodes = [], delay1, delay2, reverbNode, synth1ReverbGain, synth2ReverbGain;

// Synth Channel Gain & Pan Nodes
let synth1GainNode, synth2GainNode, synth1PannerNode, synth2PannerNode;

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

// --- Synthesizer Sound Presets ---
const synthPresets = [
    { name: "Gentle Sine", wave: "sine", atk: 0.5, dec: 2.0, cut: 1000, res: 2, trill: 0, trillKey: false, rev: 0.3 },
    { name: "Deep Warmth", wave: "sine", atk: 1.0, dec: 3.0, cut: 800, res: 1, trill: 0, trillKey: false, rev: 0.4 },
    { name: "Bright Saw Lead", wave: "sawtooth", atk: 0.05, dec: 1.5, cut: 3500, res: 5, trill: 0, trillKey: false, rev: 0.25 },
    { name: "Acid Filter Sweeper", wave: "sawtooth", atk: 0.01, dec: 0.8, cut: 1200, res: 15, trill: 0, trillKey: false, rev: 0.2 },
    { name: "Ambient Soft Tri", wave: "triangle", atk: 0.8, dec: 2.5, cut: 1500, res: 2, trill: 0, trillKey: false, rev: 0.5 },
    { name: "Hollow Square Pad", wave: "square", atk: 0.1, dec: 1.8, cut: 2000, res: 4, trill: 0, trillKey: false, rev: 0.35 },
    { name: "Trill Flute Solo", wave: "triangle", atk: 0.2, dec: 2.2, cut: 4000, res: 3, trill: 25, trillKey: true, rev: 0.45 },
    { name: "Shimmer Pulse Drone", wave: "square", atk: 0.4, dec: 3.0, cut: 5000, res: 8, trill: 40, trillKey: false, rev: 0.6 }
];
let synth1PresetIndex = 0; // Default: Gentle Sine
let synth2PresetIndex = 1; // Default: Deep Warmth

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

// --- Delay FX Presets ---
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
let delay1PresetIndex = 3;
let delay2PresetIndex = 7;

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
    document.getElementById('bpm-input').addEventListener('input', (e) => tempo = parseFloat(e.target.value));
    
    document.getElementById('seq1-length').addEventListener('change', (e) => {
        seq1Steps = parseInt(e.target.value) * 4;
        updateDisabledSteps('roll1', seq1Steps);
    });
    
    document.getElementById('seq2-length').addEventListener('change', (e) => {
        seq2Steps = parseInt(e.target.value) * 4;
        updateDisabledSteps('roll2', seq2Steps);
    });
});

// --- Audio Engine Initialization ---
async function initAudioAndMidi() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Master Output Gain
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.5;

    // Synth Volume & Panning Channels
    synth1GainNode = audioCtx.createGain();
    synth2GainNode = audioCtx.createGain();
    synth1GainNode.gain.value = parseFloat(document.getElementById('s1-vol').value);
    synth2GainNode.gain.value = parseFloat(document.getElementById('s2-vol').value);

    synth1PannerNode = audioCtx.createStereoPanner();
    synth2PannerNode = audioCtx.createStereoPanner();
    synth1PannerNode.pan.value = parseFloat(document.getElementById('s1-pan').value);
    synth2PannerNode.pan.value = parseFloat(document.getElementById('s2-pan').value);

    // Synth Signal Paths: Panner -> Gain -> Master
    synth1PannerNode.connect(synth1GainNode);
    synth1GainNode.connect(masterGain);

    synth2PannerNode.connect(synth2GainNode);
    synth2GainNode.connect(masterGain);

    // Connect Vol & Pan Sliders to Nodes
    document.getElementById('s1-vol').addEventListener('input', (e) => {
        if (synth1GainNode) synth1GainNode.gain.setValueAtTime(parseFloat(e.target.value), audioCtx.currentTime);
    });
    document.getElementById('s2-vol').addEventListener('input', (e) => {
        if (synth2GainNode) synth2GainNode.gain.setValueAtTime(parseFloat(e.target.value), audioCtx.currentTime);
    });
    document.getElementById('s1-pan').addEventListener('input', (e) => {
        if (synth1PannerNode) synth1PannerNode.pan.setValueAtTime(parseFloat(e.target.value), audioCtx.currentTime);
    });
    document.getElementById('s2-pan').addEventListener('input', (e) => {
        if (synth2PannerNode) synth2PannerNode.pan.setValueAtTime(parseFloat(e.target.value), audioCtx.currentTime);
    });

    // Convolver Reverb Setup
    reverbNode = audioCtx.createConvolver();
    reverbNode.buffer = createImpulseResponse(
        audioCtx, 
        parseFloat(document.getElementById('rev-time').value), 
        parseFloat(document.getElementById('rev-decay').value)
    );

    synth1ReverbGain = audioCtx.createGain();
    synth2ReverbGain = audioCtx.createGain();

    synth1ReverbGain.gain.value = parseFloat(document.getElementById('s1-rev-master').value);
    synth2ReverbGain.gain.value = parseFloat(document.getElementById('s2-rev-master').value);

    // Master Reverb Send Handlers
    const syncReverbInput = (synthNum, val) => {
        const revGainNode = synthNum === 1 ? synth1ReverbGain : synth2ReverbGain;
        if (revGainNode) revGainNode.gain.setValueAtTime(val, audioCtx.currentTime);
        document.getElementById(`s${synthNum}-rev-master`).value = val;
    };

    document.getElementById('s1-rev-master').addEventListener('input', (e) => syncReverbInput(1, parseFloat(e.target.value)));
    document.getElementById('s2-rev-master').addEventListener('input', (e) => syncReverbInput(2, parseFloat(e.target.value)));

    // Dynamic Impulse Response Regeneration on Time/Decay change
    const updateReverbBuffer = () => {
        const time = parseFloat(document.getElementById('rev-time').value);
        const decay = parseFloat(document.getElementById('rev-decay').value);
        reverbNode.buffer = createImpulseResponse(audioCtx, time, decay);
    };
    document.getElementById('rev-time').addEventListener('change', updateReverbBuffer);
    document.getElementById('rev-decay').addEventListener('change', updateReverbBuffer);

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

    // Serial Delay Modules
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

// Bind UI Input Sliders to Delay Effect
function bindDelayControls(containerId, delayEffect) {
    const container = document.getElementById(containerId);
    
    container.querySelector('.delay-time').addEventListener('input', (e) => delayEffect.setTime(parseFloat(e.target.value)));
    container.querySelector('.delay-fback').addEventListener('input', (e) => delayEffect.setFeedback(parseFloat(e.target.value)));
    container.querySelector('.delay-filter').addEventListener('input', (e) => delayEffect.setFilter(parseFloat(e.target.value)));
    container.querySelector('.delay-mix').addEventListener('input', (e) => delayEffect.setMix(parseFloat(e.target.value)));
}

// Apply selected Synth preset values
function applySynthPreset(synthNum, index) {
    const preset = synthPresets[index];
    const nameEl = document.getElementById(`synth${synthNum}-preset-name`);

    if (synthNum === 1) synth1PresetIndex = index;
    if (synthNum === 2) synth2PresetIndex = index;

    if (nameEl) nameEl.textContent = preset.name;

    const prefix = `s${synthNum}`;
    document.getElementById(`${prefix}-wave`).value = preset.wave;
    document.getElementById(`${prefix}-atk`).value = preset.atk;
    document.getElementById(`${prefix}-dec`).value = preset.dec;
    document.getElementById(`${prefix}-cut`).value = preset.cut;
    document.getElementById(`${prefix}-res`).value = preset.res;
    document.getElementById(`${prefix}-trill`).value = preset.trill;
    document.getElementById(`${prefix}-trill-key`).checked = preset.trillKey;
    document.getElementById(`${prefix}-rev-master`).value = preset.rev;

    if (audioCtx) {
        const revGainNode = synthNum === 1 ? synth1ReverbGain : synth2ReverbGain;
        if (revGainNode) revGainNode.gain.setValueAtTime(preset.rev, audioCtx.currentTime);
    }
}

// Apply selected EQ preset values
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

// Apply selected Delay preset values
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

    // Initial disabled step highlighting based on active length
    updateDisabledSteps('roll1', seq1Steps);
    updateDisabledSteps('roll2', seq2Steps);

    const eqContainer = document.getElementById('eq-sliders');
    for (let i = 0; i < 10; i++) {
        const wrap = document.createElement('div');
        wrap.className = 'eq-slider-container';
        wrap.innerHTML = `<input type="range" orient="vertical" id="eq-band-${i}" min="-12" max="12" step="0.1" value="0">`;
        eqContainer.appendChild(wrap);
    }

    // Synth Preset Listeners
    document.getElementById('synth1-preset-prev').addEventListener('click', () => {
        applySynthPreset(1, (synth1PresetIndex - 1 + synthPresets.length) % synthPresets.length);
    });
    document.getElementById('synth1-preset-next').addEventListener('click', () => {
        applySynthPreset(1, (synth1PresetIndex + 1) % synthPresets.length);
    });
    document.getElementById('synth2-preset-prev').addEventListener('click', () => {
        applySynthPreset(2, (synth2PresetIndex - 1 + synthPresets.length) % synthPresets.length);
    });
    document.getElementById('synth2-preset-next').addEventListener('click', () => {
        applySynthPreset(2, (synth2PresetIndex + 1) % synthPresets.length);
    });

    // EQ Selector Listeners
    document.getElementById('eq-preset-prev').addEventListener('click', () => {
        applyEqPreset((currentEqPresetIndex - 1 + eqPresets.length) % eqPresets.length);
    });
    document.getElementById('eq-preset-next').addEventListener('click', () => {
        applyEqPreset((currentEqPresetIndex + 1) % eqPresets.length);
    });

    // Delay Selector Listeners
    document.getElementById('delay1-preset-prev').addEventListener('click', () => {
        applyDelayPreset(1, (delay1PresetIndex - 1 + delayPresets.length) % delayPresets.length);
    });
    document.getElementById('delay1-preset-next').addEventListener('click', () => {
        applyDelayPreset(1, (delay1PresetIndex + 1) % delayPresets.length);
    });
    document.getElementById('delay2-preset-prev').addEventListener('click', () => {
        applyDelayPreset(2, (delay2PresetIndex - 1 + delayPresets.length) % delayPresets.length);
    });
    document.getElementById('delay2-preset-next').addEventListener('click', () => {
        applyDelayPreset(2, (delay2PresetIndex + 1) % delayPresets.length);
    });
}

// Render Interactive Grid Cells
function createPianoRoll(containerId, dataArray, visualSteps) {
    const container = document.getElementById(containerId);
    for (let row = 0; row < 12; row++) {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'pr-row';
        for (let col = 0; col < visualSteps; col++) {
            const cell = document.createElement('div');
            cell.className = 'pr-cell';
            
            // Add vertical bar border on every 4th step boundary
            if ((col + 1) % 4 === 0) {
                cell.classList.add('bar-end');
            }

            cell.id = `${containerId}-r${row}-c${col}`;
            cell.addEventListener('click', () => {
                // Prevent toggling steps that are outside the selected bar length
                if (cell.classList.contains('disabled')) return;

                dataArray[row][col] = !dataArray[row][col];
                cell.classList.toggle('active', dataArray[row][col]);
            });
            rowDiv.appendChild(cell);
        }
        container.appendChild(rowDiv);
    }
}

// Toggle .disabled class on grid cells depending on step limit
function updateDisabledSteps(containerId, activeSteps) {
    for (let row = 0; row < 12; row++) {
        for (let col = 0; col < 64; col++) {
            const cell = document.getElementById(`${containerId}-r${row}-c${col}`);
            if (cell) {
                if (col >= activeSteps) {
                    cell.classList.add('disabled');
                } else {
                    cell.classList.remove('disabled');
                }
            }
        }
    }
}

function nextNote() {
    const secondsPerBeat = 60.0 / tempo;
    nextNoteTime += secondsPerBeat;
    
    currentStep1 = (currentStep1 + 1) % seq1Steps;
    currentStep2 = (currentStep2 + 1) % seq2Steps;
}

function scheduleNote(step1, step2, time) {
    for (let row = 0; row < 12; row++) {
        if (seq1Data[row][step1]) playSynthAndMIDI(1, scale[row], time);
    }
    
    for (let row = 0; row < 12; row++) {
        if (seq2Data[row][step2]) playSynthAndMIDI(2, scale[row], time);
    }

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
    
    const baseFreq = 440 * Math.pow(2, (midiNote - 69) / 12);
    osc.type = wave;
    osc.frequency.setValueAtTime(baseFreq, time);

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
    
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cut, time);
    filter.Q.setValueAtTime(res, time); 
    
    vca.gain.setValueAtTime(0, time);
    vca.gain.linearRampToValueAtTime(0.3, time + atk);
    vca.gain.setTargetAtTime(0, time + atk, dec / 3);

    // Route signal through Pan -> Volume Gain -> Master
    const targetPanner = synthNum === 1 ? synth1PannerNode : synth2PannerNode;
    
    osc.connect(filter);
    filter.connect(vca);
    if (targetPanner) vca.connect(targetPanner);

    if (synthNum === 1 && synth1ReverbGain) vca.connect(synth1ReverbGain);
    if (synthNum === 2 && synth2ReverbGain) vca.connect(synth2ReverbGain);
    
    osc.start(time);
    osc.stop(time + atk + dec);

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