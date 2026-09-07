let audioCtx;
let midiAccess = null;
let isPlaying = false;
let masterGain, eqNodes = [], delay1, delay2, reverbNode;

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
        seq1Steps = parseInt(e.target.value) * 4; // Assuming 4 beats per bar
    });
    document.getElementById('seq2-length').addEventListener('change', (e) => {
        seq2Steps = parseInt(e.target.value) * 4;
    });
});

async function initAudioAndMidi() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Master Chain
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.5;
    
    // 10 Band EQ Setup
    const eqFrequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    let lastNode = masterGain;
    
    eqFrequencies.forEach((freq, i) => {
        const filter = audioCtx.createBiquadFilter();
        filter.type = "peaking";
        filter.frequency.value = freq;
        filter.Q.value = 1.41;
        filter.gain.value = 0; // Controlled by UI
        lastNode.connect(filter);
        lastNode = filter;
        eqNodes.push(filter);
        
        // Link EQ UI
        const slider = document.getElementById(`eq-band-${i}`);
        if(slider) {
            slider.addEventListener('input', (e) => filter.gain.value = e.target.value);
        }
    });

    // Delays Setup (Simplified as feedback delays)
    delay1 = createDelayEffect(lastNode, 0.5, 0.4, 2000);
    delay2 = createDelayEffect(delay1.output, 0.75, 0.6, 1500);
    delay2.output.connect(audioCtx.destination);

    // Reverb Setup (Impulse Response approximation)
    reverbNode = audioCtx.createConvolver();
    // In production, load a real Impulse Response audio file here via fetch
    // For this prototype, bypassing actual convolution buffering for brevity, routing direct:
    masterGain.connect(audioCtx.destination); 

    // MIDI Setup
    try {
        midiAccess = await navigator.requestMIDIAccess();
        console.log("Web MIDI API connected!");
    } catch (err) {
        console.warn("MIDI not supported or access denied.", err);
    }
}

function createDelayEffect(inputNode, time, feedback, cutoff) {
    const delayNode = audioCtx.createDelay(5.0);
    const feedbackGain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    const outGain = audioCtx.createGain();

    delayNode.delayTime.value = time;
    feedbackGain.gain.value = feedback;
    filter.frequency.value = cutoff;

    inputNode.connect(delayNode);
    delayNode.connect(filter);
    filter.connect(feedbackGain);
    feedbackGain.connect(delayNode);
    
    delayNode.connect(outGain);
    inputNode.connect(outGain); // Dry signal

    return { input: delayNode, output: outGain };
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

function playSynthAndMIDI(synthNum, midiNote, time) {
    // 1. Play Internal Web Audio Synth
    const wave = document.getElementById(`s${synthNum}-wave`).value;
    const atk = parseFloat(document.getElementById(`s${synthNum}-atk`).value);
    const dec = parseFloat(document.getElementById(`s${synthNum}-dec`).value);
    const cut = parseFloat(document.getElementById(`s${synthNum}-cut`).value);
    
    const osc = audioCtx.createOscillator();
    const vca = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    
    osc.type = wave;
    osc.frequency.value = 440 * Math.pow(2, (midiNote - 69) / 12); // MIDI to Hz
    
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cut, time);
    
    // Envelope
    vca.gain.setValueAtTime(0, time);
    vca.gain.linearRampToValueAtTime(0.3, time + atk); // Note On
    vca.gain.setTargetAtTime(0, time + atk, dec / 3); // Note Off Tail

    osc.connect(filter);
    filter.connect(vca);
    vca.connect(masterGain);
    
    osc.start(time);
    osc.stop(time + atk + dec);

    // 2. Transmit Web MIDI
    if (midiAccess) {
        const midiChannel = parseInt(document.getElementById(`s${synthNum}-midi`).value) - 1;
        const noteOnMessage = [0x90 + midiChannel, midiNote, 0x7f]; 
        const noteOffMessage = [0x80 + midiChannel, midiNote, 0x00];
        
        // Convert audio time context to DOMHighResTimeStamp for MIDI
        const timeToSchedule = performance.now() + ((time - audioCtx.currentTime) * 1000);
        
        for (let output of midiAccess.outputs.values()) {
            output.send(noteOnMessage, timeToSchedule);
            output.send(noteOffMessage, timeToSchedule + (atk * 1000));
        }
    }
}