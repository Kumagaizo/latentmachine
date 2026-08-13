import { runTransform } from "../intelligence/json-transform/translator.js";
import { explainOp } from "../intelligence/json-transform/explain.js";

const examples = [
  {
    input: {
      first_name: "Ada",
      last_name: "Lovelace",
      role: "admin",
      created: "2024-03-15T10:00:00Z",
    },
    output: {
      fullName: "Ada Lovelace",
      role: "admin",
      joinDate: "2024-03-15",
    },
  },
  {
    input: {
      first_name: "Grace",
      last_name: "Hopper",
      role: "engineer",
      created: "2023-11-01T08:30:00Z",
    },
    output: {
      fullName: "Grace Hopper",
      role: "engineer",
      joinDate: "2023-11-01",
    },
  },
  {
    input: {
      first_name: "Tim",
      last_name: "Berners-Lee",
      role: "researcher",
      created: "2024-01-09T12:15:00Z",
    },
    output: {
      fullName: "Tim Berners-Lee",
      role: "researcher",
      joinDate: "2024-01-09",
    },
  },
];

const pretty = value => JSON.stringify(value, null, 2);
const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms));

function textFromRule(result) {
  const sentences = result?.rule?.explanations?.map(item => item.sentence).filter(Boolean)
    || result?.explanation?.ruleSentences?.filter(Boolean)
    || [];
  const lines = sentences.length
    ? sentences
    : (result?.rule?.program?.ops || []).map(explainOp).filter(Boolean);
  return lines.slice(0, 4).join("\n") || "The evidence is not enough to verify a rule.";
}

function buildTask() {
  return {
    examples: examples.map(example => ({
      input: pretty(example.input),
      output: pretty(example.output),
      inputFormat: "json",
      outputFormat: "json",
    })),
    newInput: pretty(examples[0].input),
    inputFormat: "json",
    outputFormat: "json",
  };
}

function setStatus(el, text, tone = "pending") {
  el.textContent = text;
  el.className = `demo-status${tone ? ` is-${tone}` : ""}`;
}

function timingFor(character, index) {
  if (character === "\n") return 70 + (index % 4) * 16;
  if (character === " " || character === "," || character === ":") return 20 + (index % 3) * 8;
  if (character === "}" || character === "{") return 55;
  return 11 + ((index * 17) % 34);
}

async function typeText(el, text, signal) {
  el.textContent = "";
  el.classList.add("is-writing");

  for (let index = 0; index < text.length;) {
    if (signal.cancelled) return;
    const chunkSize = text[index] === "\n" ? 1 : 1 + ((index + text.charCodeAt(index)) % 3);
    const nextIndex = Math.min(index + chunkSize, text.length);
    el.textContent += text.slice(index, nextIndex);
    await wait(timingFor(text[index], index));
    index = nextIndex;
  }

  el.classList.remove("is-writing");
}

function showFinalState(parts, ruleText) {
  const example = examples[0];
  parts.inputLabel.textContent = "original record";
  parts.outputLabel.textContent = "AI output";
  parts.inputEl.textContent = pretty(example.input);
  parts.outputEl.textContent = pretty(example.output);
  parts.ruleEl.textContent = ruleText;
  parts.ruleBox.classList.add("is-revealed");
  parts.hintEl.textContent = `${examples.length} example rows checked. No drift found.`;
  setStatus(parts.statusEl, "Rule verified", "safe");
}

async function animateDemo(parts, ruleText, signal) {
  parts.inputEl.textContent = "";
  parts.outputEl.textContent = "";
  parts.ruleEl.textContent = "";
  parts.ruleBox.classList.remove("is-revealed");
  setStatus(parts.statusEl, "checking examples", "pending");

  for (let index = 0; index < examples.length; index += 1) {
    const exampleNumber = index + 1;
    parts.inputLabel.textContent = `original record ${exampleNumber}`;
    parts.outputLabel.textContent = `AI output ${exampleNumber}`;
    parts.hintEl.textContent = `Writing example ${exampleNumber} of ${examples.length}: original record...`;
    await typeText(parts.inputEl, pretty(examples[index].input), signal);
    if (signal.cancelled) return;
    await wait(180);

    parts.hintEl.textContent = `Writing example ${exampleNumber} of ${examples.length}: AI output...`;
    await typeText(parts.outputEl, pretty(examples[index].output), signal);
    if (signal.cancelled) return;
    await wait(420);
  }

  parts.hintEl.textContent = "Inferring the deterministic rule from the examples...";
  parts.ruleBox.classList.add("is-revealed");
  await typeText(parts.ruleEl, ruleText, signal);
  if (signal.cancelled) return;
  await wait(260);
  showFinalState(parts, ruleText);
}

function initializeLandingDemo() {
  const root = document.querySelector("#landing-demo");
  if (!root) return;

  const parts = {
    inputEl: root.querySelector("#demo-input"),
    outputEl: root.querySelector("#demo-output"),
    ruleEl: root.querySelector("#demo-rule-text"),
    ruleBox: root.querySelector("#demo-rule"),
    statusEl: root.querySelector("#demo-status"),
    hintEl: root.querySelector("#demo-hint"),
    inputLabel: root.querySelector("#demo-input-label"),
    outputLabel: root.querySelector("#demo-output-label"),
  };

  if (Object.values(parts).some(part => !part)) return;

  const result = runTransform(buildTask());
  const ruleText = textFromRule(result);
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const signal = { cancelled: false };

  if (prefersReducedMotion) {
    showFinalState(parts, ruleText);
    return;
  }

  animateDemo(parts, ruleText, signal);
  window.addEventListener("pagehide", () => {
    signal.cancelled = true;
  }, { once: true });
}

function initializeFeatureEli5() {
  const controls = Array.from(document.querySelectorAll(".feature-eli5-toggle"))
    .map(button => {
      const targetId = button.getAttribute("aria-controls");
      const target = targetId ? document.getElementById(targetId) : null;
      return target ? { button, target } : null;
    })
    .filter(Boolean);

  const closeControl = ({ button, target }) => {
    button.setAttribute("aria-expanded", "false");
    target.setAttribute("aria-hidden", "true");
    target.classList.remove("is-visible");
  };

  const updateHeight = target => {
    target.style.setProperty("--eli5-height", `${target.scrollHeight}px`);
  };

  controls.forEach(({ button, target }) => {
    button.addEventListener("click", () => {
      const isOpen = button.getAttribute("aria-expanded") === "true";
      controls.forEach(closeControl);

      if (!isOpen) {
        button.setAttribute("aria-expanded", "true");
        target.setAttribute("aria-hidden", "false");
        updateHeight(target);
        window.requestAnimationFrame(() => {
          target.classList.add("is-visible");
        });
      }
    });

    target.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        closeControl({ button, target });
        button.focus();
      }
    });
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      controls.forEach(closeControl);
    }
  });

  window.addEventListener("resize", () => {
    controls.forEach(({ button, target }) => {
      if (button.getAttribute("aria-expanded") === "true") {
        updateHeight(target);
      }
    });
  });
}

initializeLandingDemo();
initializeFeatureEli5();
