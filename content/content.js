// content.js - runs in the context of web pages

console.log('Hackathon Starter Extension content script loaded');

let explainerStylesInjected = false;

function ensureExplainerStyles() {
  if (explainerStylesInjected) return;
  const style = document.createElement('style');
  style.textContent = `
    .explainer-definition-panel {
      opacity: 0;
      transform: translateY(12px) scale(0.97);
      transition: opacity 260ms cubic-bezier(0.34, 1.56, 0.64, 1),
        transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .explainer-definition-panel.explainer-panel-show {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    }

    .explainer-definition-panel.explainer-panel-dragging::after {
      content: '';
      position: absolute;
      inset: -10px;
      border-radius: inherit;
      border: 1px solid rgba(59, 130, 246, 0.4);
      opacity: 0.8;
      animation: explainerDragPulse 900ms ease-in-out infinite;
      pointer-events: none;
    }

    .explainer-definition-panel.explainer-panel-drag-settle {
      animation: explainerDragSettle 420ms cubic-bezier(0.25, 1, 0.5, 1);
    }

    .explainer-panel-header {
      cursor: grab;
      user-select: none;
    }

    .explainer-word-highlight {
      opacity: 0;
      transition: opacity 170ms cubic-bezier(0.4, 0, 0.2, 1);
      background: rgba(250, 204, 21, 0.45);
    }

    .explainer-word-highlight.explainer-highlight-show {
      opacity: 1;
    }

    .explainer-popup-button {
      opacity: 0;
      transform: translateX(-10px) scaleX(0.7);
      transition: opacity 320ms cubic-bezier(0.4, 0, 0.2, 1),
        transform 360ms cubic-bezier(0.4, 0, 0.2, 1);
      transition-delay: 0ms;
      transform-origin: left center;
    }

    .explainer-word-popup.explainer-popup-show .explainer-popup-button {
      opacity: 1;
      transform: translateX(0) scaleX(1);
      transition-delay: 230ms;
    }

    @keyframes explainerSectionPulse {
      from { opacity: 0.35; }
      to { opacity: 1; }
    }

  `;
  document.head.appendChild(style);
  explainerStylesInjected = true;
}

ensureExplainerStyles();

const WORD_BUDDY_ICON_URL =
  typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL('icons/robot.png')
    : null;

function styleAudioButton(button) {
  button.style.border = 'none';
  button.style.background = '#2563eb';
  button.style.color = '#fff';
  button.style.borderRadius = '50%';
  button.style.width = '30px';
  button.style.height = '30px';
  button.style.cursor = 'pointer';
  button.style.display = 'inline-flex';
  button.style.alignItems = 'center';
  button.style.justifyContent = 'center';
  button.style.flexShrink = '0';
}

function createPopupIcon() {
  const wrapper = document.createElement('span');
  wrapper.className = 'explainer-popup-icon';
  wrapper.style.display = 'inline-flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.justifyContent = 'center';
  wrapper.style.width = '30px';
  wrapper.style.height = '30px';
  wrapper.style.borderRadius = '50%';
  wrapper.style.background = '#0f172a';
  wrapper.style.border = '1px solid rgba(148, 163, 184, 0.45)';
  wrapper.style.boxShadow = '0 2px 6px rgba(0,0,0,0.35)';
  wrapper.style.flexShrink = '0';

  if (WORD_BUDDY_ICON_URL) {
    const img = document.createElement('img');
    img.src = WORD_BUDDY_ICON_URL;
    img.alt = 'WordBuddy icon';
    img.style.width = '22px';
    img.style.height = '22px';
    img.style.objectFit = 'cover';
    img.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.45))';
    wrapper.appendChild(img);
  } else {
    wrapper.textContent = 'WB';
    wrapper.style.fontSize = '11px';
    wrapper.style.fontWeight = '600';
    wrapper.style.color = '#f8fafc';
  }

  return wrapper;
}

// Helpers
function removeWordPopup(options = {}) {
  const existing = document.querySelector('.explainer-word-popup');
  if (!existing) return;
  const animate = options.animate ?? false;
  if (animate) {
    existing.classList.remove('explainer-popup-show');
    setTimeout(() => existing.remove(), 200);
  } else {
    existing.remove();
  }
}

function removeDefinitionPopup() {
  const existing = document.querySelector('.explainer-definition-popup');
  if (existing) existing.remove();
}

function isSingleWord(text) {
  return !!text && !/\s/.test(text);
}

// Paragraph detection is implicit: anything that's not a single word is treated as text block

const wordHighlights = [];
let lastInteractionType = 'mouse';
let keyboardSelectionUpdateHandle = null;

function cancelKeyboardSelectionUpdate() {
  if (keyboardSelectionUpdateHandle) {
    clearTimeout(keyboardSelectionUpdateHandle);
    keyboardSelectionUpdateHandle = null;
  }
}

function nodeToElement(node) {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

function selectionClosest(selection, selector) {
  if (!selection || !selector) return null;
  const nodes = [selection.anchorNode, selection.focusNode];
  for (const node of nodes) {
    const el = nodeToElement(node);
    if (el) {
      const match = el.closest(selector);
      if (match) return match;
    }
  }
  return null;
}

function selectionInEditableContext(selection) {
  return !!selectionClosest(selection, 'input, textarea, [contenteditable="true"]');
}

function isSelectionInsideExplainer(selection) {
  return !!selectionClosest(selection, '.explainer-word-popup, .explainer-definition-popup');
}

function clearWordHighlights(options = {}) {
  const animate = options.animate ?? false;
  while (wordHighlights.length) {
    const el = wordHighlights.pop();
    if (!el) continue;
    if (animate) {
      el.classList.remove('explainer-highlight-show');
      setTimeout(() => el.remove(), 180);
    } else {
      el.remove();
    }
  }
}

function highlightWordRange(range, options = {}) {
  const animateClear = options.animateClear ?? false;
  clearWordHighlights({ animate: animateClear });
  if (!range) return;

  const rects = Array.from(range.getClientRects());
  rects.forEach((rect) => {
    const overlay = document.createElement('div');
    overlay.className = 'explainer-word-highlight';
    overlay.style.position = 'absolute';
    overlay.style.left = `${rect.left + window.scrollX}px`;
    overlay.style.top = `${rect.top + window.scrollY}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.background = 'rgba(250, 204, 21, 0.4)';
    overlay.style.borderRadius = '3px';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2147483646';
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('explainer-highlight-show'));
    wordHighlights.push(overlay);
  });
}

function isWordChar(char) {
  return /[A-Za-z0-9'-]/.test(char || '');
}

function getFullWordInfo(selection) {
  if (!selection || selection.rangeCount === 0) return null;
  const baseRange = selection.getRangeAt(0);
  if (baseRange.collapsed) return null;

  const workingRange = baseRange.cloneRange();
  const selectionText = selection.toString().trim();
  if (!selectionText) return null;

  const startNode = workingRange.startContainer;
  const endNode = workingRange.endContainer;

  if (startNode === endNode && startNode.nodeType === Node.TEXT_NODE) {
    const text = startNode.textContent || '';
    let start = workingRange.startOffset;
    let end = workingRange.endOffset;

    while (start > 0 && isWordChar(text[start - 1])) start -= 1;
    while (end < text.length && isWordChar(text[end])) end += 1;

    workingRange.setStart(startNode, start);
    workingRange.setEnd(startNode, end);

    const expandedWord = workingRange.toString().trim();
    if (expandedWord && isSingleWord(expandedWord)) {
      return { word: expandedWord, range: workingRange };
    }
  }

  if (isSingleWord(selectionText)) {
    return { word: selectionText, range: workingRange };
  }

  return null;
}

// --- GEMINI API INTEGRATION ---
// Replace with your actual API key
const GEMINI_API_KEY = 'AIzaSyDSk0NnQ5zRFHwkucwrX8mDBBHx66S3Ou0'; 

async function getGeminiDefinition(word) {
  console.log(`Asking Gemini for definition of: ${word}...`);
  
  // Get visible page text to use as context (limit to first 2000 chars to be safe with tokens if needed, or more)
  const pageText = document.body.innerText.substring(0, 2000); 

  const snippet = getContextSnippet(window.getSelection(), 9, 3);
  
  console.log('Context snippet for Gemini:', snippet);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  const prompt = `You are a dictionary assistant. Return ONLY minified JSON for the word below following this shape:
{
  "definition": string,
  "synonyms": string[],
  "antonyms": string[],
  "examples": string[]
}

Guidelines:
- definition <= 2 sentences, plain language.
- synonyms/antonyms arrays length 0-3 each.
- examples array length 0-2, contextual when possible.
- No extra text, markdown, code fences, or commentary.

Context (trimmed): "${pageText}..."
Context Snippet (use this to get the specific definition): "${snippet}"
Word: "${word}"
`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{
            text: prompt
          }]
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = parseGeminiJson(text);
    if (!parsed) {
      throw new Error('Gemini response could not be parsed');
    }
    return parsed;
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    throw error;
  }
}

function parseGeminiJson(rawText) {
  if (!rawText) return null;
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    const parsed = JSON.parse(rawText.slice(start, end + 1));
    return {
      definition: parsed.definition || '[No definition provided]',
      synonyms: Array.isArray(parsed.synonyms) ? parsed.synonyms : [],
      antonyms: Array.isArray(parsed.antonyms) ? parsed.antonyms : [],
      examples: Array.isArray(parsed.examples) ? parsed.examples : [],
    };
  } catch (err) {
    console.error('Failed to parse Gemini JSON', err, rawText);
    return null;
  }
}


// Small popup above selected word
function showWordPopup(range, word) {
  removeWordPopup();
  removeDefinitionPopup();

  const rect = range.getBoundingClientRect();
  const popup = document.createElement('div');
  popup.className = 'explainer-word-popup';
  popup.dataset.word = word;

  const top = rect.top + window.scrollY - 60;
  const left = rect.left + window.scrollX + rect.width / 2;

  popup.style.position = 'absolute';
  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
  popup.style.transform = 'translateX(-50%)';
  popup.style.padding = '6px 8px';
  popup.style.background = '#1f2933';
  popup.style.color = '#f9fafb';
  popup.style.borderRadius = '6px';
  popup.style.display = 'flex';
  popup.style.gap = '6px';
  popup.style.fontSize = '12px';
  popup.style.zIndex = '999999';
  popup.style.boxShadow = '0 2px 6px rgba(0,0,0,0.25)';

  const iconEl = createPopupIcon();

  const defBtn = document.createElement('button');
  defBtn.textContent = 'Definition';
  defBtn.className = 'explainer-definition-button';
  defBtn.classList.add('explainer-popup-button');
  defBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    console.log('definition button clicked');
    showDefinitionPopup(word);
  });

  // const placeholderBtn = document.createElement('button');
  // placeholderBtn.textContent = 'placeholder';
  // placeholderBtn.className = 'explainer-placeholder-button';
  // placeholderBtn.addEventListener('click', (event) => {
  //   event.stopPropagation();
  //   console.log('placeholder clicked (delegated) for word:', word);
  // });

  // basic styling
  // [defBtn, placeholderBtn].forEach((btn) => {
  //   btn.style.border = 'none';
  //   btn.style.borderRadius = '4px';
  //   btn.style.padding = '4px 6px';
  //   btn.style.cursor = 'pointer';
  //   btn.style.color = '#fff';
  // });
  defBtn.style.border = 'none';
  defBtn.style.borderRadius = '4px';
  defBtn.style.padding = '4px 6px';
  defBtn.style.cursor = 'pointer';
  defBtn.style.color = '#ffffffff';
  defBtn.style.background = '#2563eb';

  // placeholderBtn.addEventListener('click', () => {
  //   console.log('placeholder clicked for word:', word);
  // });  
  // defBtn.style.background = '#2563eb';
  // placeholderBtn.style.background = '#4b5563';

  popup.appendChild(iconEl);
  popup.appendChild(defBtn);
  // popup.appendChild(placeholderBtn);
  document.body.appendChild(popup);
  requestAnimationFrame(() => popup.classList.add('explainer-popup-show'));
}

function showSentencePopup(range, sentence) {
  removeWordPopup();
  removeDefinitionPopup();

  const rect = range.getBoundingClientRect();
  const popup = document.createElement('div');
  popup.className = 'explainer-word-popup explainer-sentence-popup';
  const preview = sentence.length > 200 ? `${sentence.slice(0, 200).trim()}…` : sentence;
  popup.dataset.summaryPreview = preview;
  popup.summaryValue = sentence;

  const top = rect.top + window.scrollY - 60;
  const left = rect.left + window.scrollX + rect.width / 2;

  popup.style.position = 'absolute';
  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
  popup.style.transform = 'translateX(-50%)';
  popup.style.padding = '6px 8px';
  popup.style.background = '#1f2933';
  popup.style.color = '#f9fafb';
  popup.style.borderRadius = '6px';
  popup.style.display = 'flex';
  popup.style.gap = '6px';
  popup.style.fontSize = '12px';
  popup.style.zIndex = '999999';
  popup.style.boxShadow = '0 2px 6px rgba(0,0,0,0.25)';

  const iconEl = createPopupIcon();

  const summaryBtn = document.createElement('button');
  summaryBtn.textContent = 'Clarification';
  summaryBtn.className = 'explainer-summary-button';
  summaryBtn.classList.add('explainer-popup-button');
  summaryBtn.style.border = 'none';
  summaryBtn.style.borderRadius = '4px';
  summaryBtn.style.padding = '4px 6px';
  summaryBtn.style.cursor = 'pointer';
  summaryBtn.style.color = '#fff';
  summaryBtn.style.background = '#10b981';

  summaryBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    console.log('summary button clicked');
    showSummaryPopup(sentence);
  });

  popup.appendChild(iconEl);
  popup.appendChild(summaryBtn);
  document.body.appendChild(popup);
  requestAnimationFrame(() => popup.classList.add('explainer-popup-show'));
}

// Big definition popup (3 placeholder sections)
function showDefinitionPopup(word) {
  removeDefinitionPopup();

  const overlay = document.createElement('div');
  overlay.className = 'explainer-definition-popup';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.right = '0';
  overlay.style.bottom = '0';
  overlay.style.background = 'rgba(0,0,0,0.5)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex = '2147483647';

  const panel = document.createElement('div');
  panel.className = 'explainer-definition-panel';
  panel.style.background = '#111827';
  panel.style.color = '#f9fafb';
  panel.style.borderRadius = '10px';
  panel.style.padding = '16px 20px';
  panel.style.width = 'min(420px, 90vw)';
  panel.style.maxHeight = '80vh';
  panel.style.overflowY = 'auto';
  panel.style.boxShadow = '0 10px 30px rgba(0,0,0,0.4)';
  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';
  panel.style.gap = '12px';
  panel.style.fontSize = '14px';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';

  const title = document.createElement('div');
  title.textContent = word;
  title.style.fontSize = '18px';
  title.style.fontWeight = '600';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.border = 'none';
  closeBtn.style.background = 'transparent';
  closeBtn.style.color = '#9ca3af';
  closeBtn.style.fontSize = '20px';
  closeBtn.style.cursor = 'pointer';

  header.appendChild(title);
  header.appendChild(closeBtn);

  function makeSection(label, options = {}) {
    const section = document.createElement('section');
    section.style.borderTop = '1px solid #1f2933';
    section.style.paddingTop = '8px';

    const headerRow = document.createElement('div');
    headerRow.style.display = 'flex';
    headerRow.style.alignItems = 'center';
    headerRow.style.justifyContent = 'space-between';
    headerRow.style.gap = '8px';

    const h = document.createElement('h3');
    h.textContent = label;
    h.style.fontSize = '13px';
    h.style.fontWeight = '600';
    h.style.textTransform = 'uppercase';
    h.style.letterSpacing = '0.05em';
    h.style.margin = '8px 0 4px';
    h.style.color = '#9ca3af';

    headerRow.appendChild(h);

    let audioButton = null;
    if (options.showAudioButton) {
      audioButton = document.createElement('button');
      audioButton.textContent = '🔊';
      styleAudioButton(audioButton);
      audioButton.disabled = true;
      audioButton.title = 'Loading audio...';
      headerRow.appendChild(audioButton);
    }

    const body = document.createElement('div');
    body.textContent = '[placeholder]';
    body.style.fontSize = '14px';
    body.style.color = '#e5e7eb';

    section.appendChild(headerRow);
    section.appendChild(body);

    return { section, body, audioButton };
  }

  const sectionPron = makeSection('Audio pronunciation & phonetics');
  const sectionDefinition = makeSection('Definition', { showAudioButton: true });
  const sectionSynAnt = makeSection('Synonyms / Antonyms', { showAudioButton: true });
  const sectionExamples = makeSection('Contextual examples', { showAudioButton: true });

  panel.appendChild(header);
  panel.appendChild(sectionPron.section);
  panel.appendChild(sectionDefinition.section);
  panel.appendChild(sectionSynAnt.section);
  panel.appendChild(sectionExamples.section);

  setLoadingState(sectionDefinition.body, 'definition');
  setLoadingState(sectionSynAnt.body, 'synonyms/antonyms');
  setLoadingState(sectionExamples.body, 'examples');

  populatePronunciationSection(word, sectionPron.body);
  populateGeminiSections(word, sectionDefinition, sectionSynAnt, sectionExamples);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.classList.add('explainer-overlay-show');
    panel.classList.add('explainer-panel-show');
  });

  const dismissOverlay = () => {
    if (overlay.dataset.closing === 'true') return;
    overlay.dataset.closing = 'true';
    overlay.classList.remove('explainer-overlay-show');
    panel.classList.remove('explainer-panel-show');
    setTimeout(() => overlay.remove(), 260);
  };

  closeBtn.addEventListener('click', (event) => {
    event.preventDefault();
    dismissOverlay();
  });

  // Close when clicking outside the panel
  overlay.addEventListener('mousedown', (e) => {
    if (!panel.contains(e.target)) dismissOverlay();
  });
}

function showSummaryPopup(sentence) {
  removeDefinitionPopup();

  const overlay = document.createElement('div');
  overlay.className = 'explainer-definition-popup';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.right = '0';
  overlay.style.bottom = '0';
  overlay.style.background = 'rgba(0,0,0,0.5)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex = '2147483647';

  const panel = document.createElement('div');
  panel.className = 'explainer-definition-panel';
  panel.style.background = '#111827';
  panel.style.color = '#f9fafb';
  panel.style.borderRadius = '10px';
  panel.style.padding = '18px 22px';
  panel.style.width = 'min(420px, 90vw)';
  panel.style.maxHeight = '80vh';
  panel.style.overflowY = 'auto';
  panel.style.boxShadow = '0 10px 30px rgba(0,0,0,0.4)';
  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';
  panel.style.gap = '12px';
  panel.style.fontSize = '14px';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'flex-start';

  const titleGroup = document.createElement('div');
  titleGroup.style.display = 'flex';
  titleGroup.style.flexDirection = 'column';
  titleGroup.style.gap = '4px';

  const title = document.createElement('div');
  title.textContent = 'Clarification';
  title.style.fontSize = '18px';
  title.style.fontWeight = '600';

  const subtitle = document.createElement('div');
  const trimmedSentence = sentence.length > 160 ? `${sentence.slice(0, 160).trim()}…` : sentence;
  subtitle.textContent = trimmedSentence;
  subtitle.style.fontSize = '12px';
  subtitle.style.color = '#9ca3af';

  titleGroup.appendChild(title);
  if (trimmedSentence) {
    titleGroup.appendChild(subtitle);
  }

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.border = 'none';
  closeBtn.style.background = 'transparent';
  closeBtn.style.color = '#9ca3af';
  closeBtn.style.fontSize = '20px';
  closeBtn.style.cursor = 'pointer';

  header.appendChild(titleGroup);
  header.appendChild(closeBtn);

  const summarySection = document.createElement('section');
  summarySection.style.borderTop = '1px solid #1f2933';
  summarySection.style.paddingTop = '10px';

  const summaryHeading = document.createElement('h3');
  summaryHeading.textContent = 'Clarification';
  summaryHeading.style.fontSize = '13px';
  summaryHeading.style.fontWeight = '600';
  summaryHeading.style.textTransform = 'uppercase';
  summaryHeading.style.letterSpacing = '0.05em';
  summaryHeading.style.margin = '4px 0 6px';
  summaryHeading.style.color = '#9ca3af';

  const summaryBody = document.createElement('div');
  summaryBody.style.display = 'flex';
  summaryBody.style.alignItems = 'flex-start';
  summaryBody.style.gap = '10px';

  const summaryText = document.createElement('div');
  summaryText.style.flex = '1';
  summaryText.style.fontSize = '14px';
  summaryText.style.color = '#e5e7eb';
  summaryText.style.minHeight = '42px';
  setLoadingState(summaryText, 'summary');

  const summaryAudioButton = document.createElement('button');
  summaryAudioButton.textContent = '🔊';
  styleAudioButton(summaryAudioButton);
  summaryAudioButton.disabled = true;
  summaryAudioButton.title = 'Generating summary...';

  summaryBody.appendChild(summaryText);
  summaryBody.appendChild(summaryAudioButton);

  summarySection.appendChild(summaryHeading);
  summarySection.appendChild(summaryBody);

  const chatSection = createChatSection();

  panel.appendChild(header);
  panel.appendChild(summarySection);
  panel.appendChild(chatSection.section);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.classList.add('explainer-overlay-show');
    panel.classList.add('explainer-panel-show');
  });

  const dismissOverlay = () => {
    if (overlay.dataset.closing === 'true') return;
    overlay.dataset.closing = 'true';
    overlay.classList.remove('explainer-overlay-show');
    panel.classList.remove('explainer-panel-show');
    setTimeout(() => overlay.remove(), 260);
  };

  closeBtn.addEventListener('click', (event) => {
    event.preventDefault();
    dismissOverlay();
  });

  overlay.addEventListener('mousedown', (event) => {
    if (!panel.contains(event.target)) dismissOverlay();
  });

  populateSummarySection(sentence, summaryText, summaryAudioButton);
  setupGeminiChat(chatSection, sentence);
}

async function populatePronunciationSection(word, container) {
  container.textContent = 'Loading pronunciation...';
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.gap = '8px';

  try {
    const data = await fetchPronunciationData(word);
    container.innerHTML = '';

    const phoneticEl = document.createElement('span');
    phoneticEl.textContent = data.phoneticText;
    phoneticEl.style.fontWeight = '600';
    container.appendChild(phoneticEl);

    const audioButton = document.createElement('button');
    audioButton.textContent = '🔊';
    styleAudioButton(audioButton);

    if (data.audioUrl) {
      const audio = new Audio(data.audioUrl);
      audioButton.addEventListener('click', (event) => {
        event.stopPropagation();
        event.preventDefault();
        audio.currentTime = 0;
        audio.play().catch((err) => console.error('Audio playback failed', err));
      });
    } else if ('speechSynthesis' in window) {
      audioButton.addEventListener('click', (event) => {
        event.stopPropagation();
        event.preventDefault();
        speakText(word);
      });
    } else {
      audioButton.disabled = true;
      audioButton.title = 'Audio not available';
    }

    container.appendChild(audioButton);
    animateSectionReveal(container);
  } catch (error) {
    console.error('Failed to load pronunciation', error);
    container.textContent = 'Could not load pronunciation.';
    animateSectionReveal(container);
  }
}

async function fetchPronunciationData(word) {
  const lowerWord = word.toLowerCase();

  // 1. Try dictionaryapi.dev for IPA + audio
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lowerWord)}`);
    if (res.ok) {
      const json = await res.json();
      const entry = Array.isArray(json) && json.length ? json[0] : null;
      const phoneticsList = entry?.phonetics || [];
      const phoneticText = entry?.phonetic || phoneticsList.find((p) => p.text)?.text;
      const audioUrl = phoneticsList.find((p) => p.audio)?.audio;
      if (phoneticText || audioUrl) {
        return {
          phoneticText: phoneticText || fallbackPhonetic(word),
          audioUrl: audioUrl || null,
        };
      }
    }
    throw new Error('Dictionary data missing');
  } catch (err) {
    // continue to fallback
  }

  // 2. Try Datamuse for pron tag (covers many names / proper nouns)
  try {
    const res = await fetch(`https://api.datamuse.com/words?sp=${encodeURIComponent(lowerWord)}&max=1&md=r`);
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json) && json.length) {
        const entry = json[0];
        const ipaTag = entry.tags?.find((tag) => tag.startsWith('ipa_pron:'));
        const pronTag = entry.tags?.find((tag) => tag.startsWith('pron:'));
        const phoneticText = ipaTag?.split(':')[1] || pronTag?.split(':')[1];
        if (phoneticText) {
          return {
            phoneticText: `/${phoneticText}/`,
            audioUrl: null,
          };
        }
      }
    }
  } catch (err) {
    // ignore and proceed to fallback
  }

  // 3. Fallback: naive phonetic + Web Speech audio
  return {
    phoneticText: fallbackPhonetic(word),
    audioUrl: null,
  };
}

function fallbackPhonetic(word) {
  return `/${word.split('').join('·')}/`;
}

function updateSelectionUI(trigger = 'mouse') {
  const selection = window.getSelection();
  const animateClear = trigger !== 'mouse';

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    clearWordHighlights({ animate: animateClear });
    removeWordPopup({ animate: true });
    return;
  }

  if (selectionInEditableContext(selection)) {
    clearWordHighlights({ animate: animateClear });
    removeWordPopup({ animate: true });
    return;
  }

  if (isSelectionInsideExplainer(selection)) {
    return;
  }

  const selectedText = selection.toString().trim();
  if (!selectedText) {
    clearWordHighlights({ animate: animateClear });
    removeWordPopup({ animate: true });
    return;
  }

  if (!isSingleWord(selectedText)) {
    const paragraphRange = selection.getRangeAt(0).cloneRange();
    highlightWordRange(paragraphRange, { animateClear });
    showSentencePopup(paragraphRange, selectedText);
    return;
  }

  const wordInfo = getFullWordInfo(selection);
  if (!wordInfo) {
    clearWordHighlights({ animate: animateClear });
    removeWordPopup({ animate: true });
    return;
  }

  const { word, range } = wordInfo;
  highlightWordRange(range, { animateClear });
  showWordPopup(range, word);
}

// Mouseup: use pointer selection updates
document.addEventListener('mouseup', (event) => {
  if (event.target.closest('.explainer-word-popup') || event.target.closest('.explainer-definition-popup')) {
    return;
  }
  lastInteractionType = 'mouse';
  cancelKeyboardSelectionUpdate();
  updateSelectionUI('mouse');
});

// Prevent mouseup on our popup buttons from re-triggering selection logging
document.addEventListener('mouseup', (event) => {
  if (event.target.closest('.explainer-word-popup') || event.target.closest('.explainer-definition-popup')) {
    event.stopPropagation();
  }
}, true);

document.addEventListener('keydown', () => {
  lastInteractionType = 'keyboard';
});

// Click elsewhere: hide only the small popup
document.addEventListener('mousedown', (event) => {
  lastInteractionType = 'mouse';
  cancelKeyboardSelectionUpdate();
  const popup = document.querySelector('.explainer-word-popup');
  const defPopup = document.querySelector('.explainer-definition-popup');
  if (popup && !popup.contains(event.target) && !defPopup?.contains(event.target)) {
    removeWordPopup({ animate: true });
  }
});

// Global click handler for popup buttons
document.addEventListener('click', (event) => {
  const target = event.target;
  const popup = target.closest('.explainer-word-popup');
  const wordFromPopup = popup?.dataset.word || '';
  const sentenceFromPopup = popup?.summaryValue || popup?.dataset.summaryPreview || '';

  // definition button
  if (target.classList.contains('explainer-definition-button')) {
    console.log('definition clicked (delegated) for word:', wordFromPopup);
    return;
  }

  // placeholder button
  if (target.classList.contains('explainer-placeholder-button')) {
    console.log('placeholder clicked (delegated) for word:', wordFromPopup);
    return;
  }

  if (target.classList.contains('explainer-summary-button')) {
    console.log('summary clicked (delegated) for sentence:', sentenceFromPopup);
  }
});

document.addEventListener('selectionchange', () => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    clearWordHighlights({ animate: true });
    removeWordPopup({ animate: true });
    cancelKeyboardSelectionUpdate();
    return;
  }

  if (lastInteractionType === 'keyboard') {
    if (keyboardSelectionUpdateHandle) {
      clearTimeout(keyboardSelectionUpdateHandle);
    }
    keyboardSelectionUpdateHandle = setTimeout(() => {
      keyboardSelectionUpdateHandle = null;
      updateSelectionUI('keyboard');
    }, 120);
  }
});

async function populateDefinitionSection(geminiPromise, container) {
  container.textContent = 'Loading definition...';

  try {
    const definition = await geminiPromise;
    container.textContent = definition;
  } catch (error) {
    console.error('Error populating definition section:', error);
    container.textContent = 'Could not load definition.';
  }
}

async function populateSynAntSection(geminiPromise, container) {
  container.textContent = 'Loading synonyms/antonyms...';

  try {
    const definition = await geminiPromise;
    const { synonyms, antonyms } = extractSynonymsAntonyms(definition);

    container.innerHTML = '';

    if (synonyms.length) {
      const synTitle = document.createElement('strong');
      synTitle.textContent = 'Synonyms:';
      container.appendChild(synTitle);

      synonyms.forEach((syn) => {
        const chip = createChip(syn, 'synonym');
        container.appendChild(chip);
      });
    }

    if (antonyms.length) {
      const antTitle = document.createElement('strong');
      antTitle.textContent = 'Antonyms:';
      container.appendChild(antTitle);

      antonyms.forEach((ant) => {
        const chip = createChip(ant, 'antonym');
        container.appendChild(chip);
      });
    }
  } catch (error) {
    console.error('Error populating synonyms/antonyms section:', error);
    container.textContent = 'Could not load synonyms/antonyms.';
  }
}

async function populateExamplesSection(geminiPromise, container) {
  container.textContent = 'Loading examples...';

  try {
    const definition = await geminiPromise;
    const examples = extractExamples(definition);

    container.innerHTML = '';

    if (examples.length) {
      examples.forEach((example) => {
        const block = document.createElement('div');
        block.textContent = example;
        block.style.background = '#374151';
        block.style.padding = '8px';
        block.style.borderRadius = '6px';
        block.style.marginTop = '4px';
        block.style.color = '#e5e7eb';
        container.appendChild(block);
      });
    } else {
      container.textContent = 'No examples found.';
    }
  } catch (error) {
    console.error('Error populating examples section:', error);
    container.textContent = 'Could not load examples.';
  }
}

function extractSynonymsAntonyms(definition) {
  const synonymAntonymPattern = /(?:Synonyms?:\s*([^;]*);?|Antonyms?:\s*([^;]*);?)/gi;
  const result = { synonyms: [], antonyms: [] };
  let match;

  while ((match = synonymAntonymPattern.exec(definition))) {
    const [_, syns, ants] = match;
    if (syns) {
      result.synonyms = syns.split(',').map((s) => s.trim());
    }
    if (ants) {
      result.antonyms = ants.split(',').map((a) => a.trim());
    }
  }

  return result;
}

function extractExamples(definition) {
  const examplePattern = /(?:Example:|E.g.:?)\s*(.*?)(?:\n|$)/i;
  const examples = [];
  let match;

  while ((match = examplePattern.exec(definition))) {
    examples.push(match[1].trim());
  }

  return examples;
}

function createChip(text, type) {
  const chip = document.createElement('span');
  chip.textContent = text;
  chip.className = `chip chip-${type}`;
  chip.style.display = 'inline-block';
  chip.style.background = type === 'synonym' ? '#2563eb' : '#ef4444';
  chip.style.color = '#fff';
  chip.style.borderRadius = '16px';
  chip.style.padding = '4px 8px';
  chip.style.marginRight = '6px';
  chip.style.fontSize = '12px';
  chip.style.cursor = 'default';

  return chip;
}

function setLoadingState(element, label) {
  element.textContent = `Loading ${label}...`;
  element.style.opacity = '0.75';
  element.style.animation = 'explainerSectionPulse 1.4s ease-in-out infinite alternate';
}

function clearLoadingState(element) {
  if (!element) return;
  element.style.opacity = '1';
  element.style.animation = '';
}

async function populateGeminiSections(word, definitionSection, synAntSection, examplesSection) {
  const definitionEl = definitionSection.body;
  const synAntEl = synAntSection.body;
  const examplesEl = examplesSection.body;

  try {
    const data = await getGeminiDefinition(word);
    const definitionText = data.definition?.trim() || 'No definition available.';
    clearLoadingState(definitionEl);
    definitionEl.textContent = definitionText;
    animateSectionReveal(definitionEl);
    setupAudioButton(definitionSection.audioButton, definitionText, 'Read definition');

    const synonymsText = formatList(data.synonyms, 'No synonyms available.');
    const antonymsText = formatList(data.antonyms, 'No antonyms available.');
    clearLoadingState(synAntEl);
    synAntEl.innerHTML = `<div><strong>Synonyms:</strong> ${synonymsText}</div><div><strong>Antonyms:</strong> ${antonymsText}</div>`;
    animateSectionReveal(synAntEl);
    const synAntAudio = [
      data.synonyms?.length ? `Synonyms: ${data.synonyms.join(', ')}` : 'No synonyms available.',
      data.antonyms?.length ? `Antonyms: ${data.antonyms.join(', ')}` : 'No antonyms available.'
    ].join(' ');
    setupAudioButton(synAntSection.audioButton, synAntAudio.trim(), 'Read synonyms and antonyms');

    clearLoadingState(examplesEl);
    let examplesAudioText = 'No contextual examples available.';
    if (data.examples?.length) {
      examplesEl.innerHTML = data.examples.map((ex) => `<div>• ${ex}</div>`).join('');
      examplesAudioText = data.examples.map((ex, index) => `Example ${index + 1}: ${ex}`).join('. ');
    } else {
      examplesEl.textContent = 'No contextual examples available.';
    }
    animateSectionReveal(examplesEl);
    setupAudioButton(examplesSection.audioButton, examplesAudioText, 'Read examples');
  } catch (error) {
    clearLoadingState(definitionEl);
    clearLoadingState(synAntEl);
    clearLoadingState(examplesEl);
    definitionEl.textContent = 'Unable to load data from Gemini.';
    synAntEl.textContent = '—';
    examplesEl.textContent = '—';
    animateSectionReveal(definitionEl);
    animateSectionReveal(synAntEl);
    animateSectionReveal(examplesEl);
    disableAudioButton(definitionSection.audioButton);
    disableAudioButton(synAntSection.audioButton);
    disableAudioButton(examplesSection.audioButton);
  }
}

function formatList(items, emptyText) {
  if (!items || !items.length) return emptyText;
  return items.join(', ');
}

function animateSectionReveal(element) {
  if (!element) return;
  element.style.animation = 'explainerSectionPulse 280ms ease';
  element.addEventListener('animationend', () => {
    element.style.animation = '';
  }, { once: true });
}

function createChatSection() {
  const section = document.createElement('section');
  section.style.borderTop = '1px solid #1f2933';
  section.style.paddingTop = '10px';
  section.style.display = 'flex';
  section.style.flexDirection = 'column';
  section.style.gap = '8px';

  const heading = document.createElement('h3');
  heading.textContent = 'Ask Gemini';
  heading.style.fontSize = '13px';
  heading.style.fontWeight = '600';
  heading.style.textTransform = 'uppercase';
  heading.style.letterSpacing = '0.05em';
  heading.style.color = '#9ca3af';
  heading.style.margin = '4px 0 2px';

  const helper = document.createElement('p');
  helper.textContent = 'Chat about the highlighted text in simple language.';
  helper.style.margin = '0';
  helper.style.fontSize = '13px';
  helper.style.color = '#9ca3af';

  const historyContainer = document.createElement('div');
  historyContainer.className = 'explainer-chat-history';
  historyContainer.style.background = '#0b1220';
  historyContainer.style.border = '1px solid #1f2937';
  historyContainer.style.borderRadius = '8px';
  historyContainer.style.padding = '10px';
  historyContainer.style.maxHeight = '180px';
  historyContainer.style.overflowY = 'auto';
  historyContainer.style.display = 'flex';
  historyContainer.style.flexDirection = 'column';
  historyContainer.style.gap = '8px';
  historyContainer.dataset.empty = 'true';

  const form = document.createElement('form');
  form.style.display = 'flex';
  form.style.gap = '8px';

  const input = document.createElement('textarea');
  input.rows = 2;
  input.placeholder = 'Ask a question or share a thought…';
  input.style.flex = '1';
  input.style.resize = 'vertical';
  input.style.background = '#1f2937';
  input.style.border = '1px solid #374151';
  input.style.borderRadius = '8px';
  input.style.color = '#f9fafb';
  input.style.padding = '8px';
  input.style.fontSize = '13px';

  const micBtn = document.createElement('button');
  micBtn.type = 'button';
  micBtn.textContent = '🎙️';
  micBtn.style.background = '#374151';
  micBtn.style.border = '1px solid #4b5563';
  micBtn.style.color = '#f9fafb';
  micBtn.style.borderRadius = '8px';
  micBtn.style.padding = '0 12px';
  micBtn.style.fontSize = '18px';
  micBtn.style.display = 'flex';
  micBtn.style.alignItems = 'center';
  micBtn.style.justifyContent = 'center';
  micBtn.style.cursor = 'pointer';
  micBtn.title = 'Start voice input';

  const sendBtn = document.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.textContent = 'Send';
  sendBtn.style.background = '#2563eb';
  sendBtn.style.border = 'none';
  sendBtn.style.borderRadius = '8px';
  sendBtn.style.color = '#fff';
  sendBtn.style.padding = '8px 12px';
  sendBtn.style.fontWeight = '600';
  sendBtn.style.cursor = 'pointer';

  form.appendChild(micBtn);
  form.appendChild(input);
  form.appendChild(sendBtn);

  section.appendChild(heading);
  section.appendChild(helper);
  section.appendChild(historyContainer);
  section.appendChild(form);

  return { section, historyContainer, input, sendBtn, form, micBtn };
}

function appendChatMessage(container, role, text) {
  if (container.dataset.empty === 'true') {
    container.innerHTML = '';
    delete container.dataset.empty;
  }
  const bubble = document.createElement('div');
  bubble.className = `explainer-chat-bubble explainer-chat-${role}`;
  bubble.textContent = text;
  bubble.style.padding = '8px 10px';
  bubble.style.borderRadius = '8px';
  bubble.style.fontSize = '13px';
  bubble.style.lineHeight = '1.4';
  bubble.style.whiteSpace = 'pre-wrap';
  bubble.style.background = role === 'user' ? '#1d4ed8' : '#1f2937';
  bubble.style.color = '#f9fafb';
  bubble.style.alignSelf = role === 'user' ? 'flex-end' : 'flex-start';
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

function setupGeminiChat(chatElements, highlightedText) {
  const { historyContainer, input, sendBtn, form, micBtn } = chatElements;
  const conversation = [];

  const setSendingState = (isSending) => {
    sendBtn.disabled = isSending;
    sendBtn.textContent = isSending ? 'Sending…' : 'Send';
  };

  const setMicState = (isListening) => {
    if (!micBtn) return;
    micBtn.dataset.listening = isListening ? 'true' : 'false';
    micBtn.style.background = isListening ? '#b91c1c' : '#374151';
    micBtn.style.borderColor = isListening ? '#f87171' : '#4b5563';
    micBtn.textContent = isListening ? '⏹' : '🎙️';
    micBtn.title = isListening ? 'Listening… tap to stop' : 'Start voice input';
  };

  const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  let recognition = null;
  let recognitionBase = '';

  if (micBtn) {
    if (!SpeechRecognitionClass) {
      micBtn.disabled = true;
      micBtn.title = 'Voice input not supported in this browser';
    } else {
      recognition = new SpeechRecognitionClass();
      recognition.lang = 'en-US';
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.addEventListener('start', () => setMicState(true));
      recognition.addEventListener('end', () => setMicState(false));
      recognition.addEventListener('error', (event) => {
        console.error('Speech recognition error', event.error);
        setMicState(false);
        micBtn.title = 'Voice input error. Tap to retry.';
      });
      recognition.addEventListener('result', (event) => {
        const transcript = Array.from(event.results)
          .map((result) => result[0]?.transcript || '')
          .join(' ');
        const finalText = `${recognitionBase}${transcript}`.trim();
        input.value = finalText;
        input.focus();
      });

      micBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (micBtn.dataset.listening === 'true') {
          recognition.stop();
          return;
        }
        recognitionBase = input.value.trim();
        if (recognitionBase) recognitionBase += ' ';
        try {
          recognition.start();
        } catch (err) {
          console.error('Failed to start speech recognition', err);
        }
      });
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    const userMessage = input.value.trim();
    if (!userMessage) return;
    if (micBtn && micBtn.dataset.listening === 'true') {
      recognition?.stop();
    }
    input.value = '';
    appendChatMessage(historyContainer, 'user', userMessage);
    conversation.push({ role: 'user', content: userMessage });
    setSendingState(true);
    try {
      const reply = await getGeminiChatResponse(highlightedText, conversation);
      appendChatMessage(historyContainer, 'assistant', reply);
      conversation.push({ role: 'assistant', content: reply });
    } catch (error) {
      console.error('Gemini chat error', error);
      appendChatMessage(historyContainer, 'assistant', 'Sorry, I could not respond right now. Please try again.');
    } finally {
      setSendingState(false);
      input.focus();
    }
  };

  form.addEventListener('submit', handleSubmit);
}

async function populateSummarySection(text, container, audioButton) {
  try {
    const summary = await getGeminiTextSummary(text);
    clearLoadingState(container);
    container.textContent = summary;
    setupAudioButton(audioButton, summary, 'Play summary audio');
    animateSectionReveal(container);
  } catch (error) {
    console.error('Error generating summary', error);
    clearLoadingState(container);
    container.textContent = 'Unable to generate summary.';
    disableAudioButton(audioButton, 'Audio unavailable');
    animateSectionReveal(container);
  }
}

function setupAudioButton(button, text, title = 'Play audio') {
  if (!button) return;
  if (!('speechSynthesis' in window)) {
    button.disabled = true;
    button.title = 'Audio not supported';
    button.onclick = null;
    return;
  }
  if (!text || !text.trim()) {
    button.disabled = true;
    button.title = 'Nothing to read';
    button.onclick = null;
    return;
  }
  button.disabled = false;
  button.title = title;
  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    speakText(text);
  };
}

function disableAudioButton(button, title = 'Audio unavailable') {
  if (!button) return;
  button.disabled = true;
  button.title = title;
  button.onclick = null;
}

function speakText(text) {
  if (!text || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  speechSynthesis.speak(utterance);
}

async function getGeminiTextSummary(text) {
  console.log('Requesting Gemini summary for text:', text.slice(0, 120));
  const context = document.body.innerText.substring(0, 3000);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  const prompt = `Summarize the following text in the simplest possible language (grade school level). Use at most three short sentences. Do not add bullet points, markdown, or commentary. Respond with plain text only.\n\nText: "${text}"\n\nExtra context from the page:"${context}..."`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: prompt }],
      }],
      // generationConfig: {
      //   temperature: 0.2,
      //   maxOutputTokens: 512,
      // },
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini summary error: ${response.statusText}`);
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const summary = parts.map((part) => part.text || '').join(' ').trim();
  if (!summary) {
    throw new Error('Gemini summary response was empty');
  }
  return summary;
}

async function getGeminiChatResponse(highlightedText, history) {
  const context = document.body.innerText.substring(0, 2000);
  const transcript = history.map((entry) => {
    const prefix = entry.role === 'user' ? 'Learner' : 'Guide';
    return `${prefix}: ${entry.content}`;
  }).join('\n');
  const latestUserMessage = [...history].reverse().find((entry) => entry.role === 'user')?.content || '';

  const prompt = `You are a patient study buddy who explains ideas in plain language for learners with reading challenges. Keep replies under four short sentences and avoid complex vocabulary.\n\nHighlighted text:\n"""${highlightedText}"""\n\nConversation so far:\n${transcript || 'None yet.'}\n\nLearner just said:\n"${latestUserMessage}"\n\nRespond kindly and clearly.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: prompt }],
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 512,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini chat error: ${response.statusText}`);
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const reply = parts.map((part) => part.text || '').join(' ').trim();
  if (!reply) {
    throw new Error('Gemini chat response was empty');
  }
  return reply;
}

/**
 * Return a snippet containing up to `beforeCount` words before the highlighted word
 * plus the highlighted word itself. Accepts a Selection or a Range object.
 *
 * Examples:
 *   getContextSnippet(selection, 9)
 *   getContextSnippet(range)
 */
function getContextSnippet(selOrRange, beforeCount = 9, afterCount = 3) {
  let range = null;
  if (!selOrRange) return '';

    if (!selOrRange) return '';

    if (selOrRange instanceof Range) {
      range = selOrRange.cloneRange();
    } else if (selOrRange instanceof Selection && selOrRange.rangeCount) {
      range = selOrRange.getRangeAt(0).cloneRange();
    } else {
      return '';
    }

    if (!range || range.collapsed) return '';

    // Helper: walk backwards through text nodes starting from a container/offset
    function collectTextBefore(node, offset, maxChars = 5000) {
      let pieces = [];
      let remaining = maxChars;

      // If we're in a text node, take the left portion up to offset
      if (node.nodeType === Node.TEXT_NODE) {
        const txt = (node.textContent || '').slice(0, offset);
        pieces.unshift(txt);
        remaining -= txt.length;
      }

      // Walk previous nodes in document order to collect more text until limit
      let walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      // Move walker to the current node
      walker.currentNode = node;

      while (remaining > 0) {
        const prev = walker.previousNode();
        if (!prev) break;
        const txt = prev.textContent || '';
        if (!txt.trim()) continue;
        // Prepend, but cap by remaining
        if (txt.length > remaining) {
          pieces.unshift(txt.slice(-remaining));
          break;
        } else {
          pieces.unshift(txt);
          remaining -= txt.length;
        }
      }

      return pieces.join(' ');
    }

    // Get the selected word text
    const selectedText = range.toString().trim();

    // Collect a window of text before the selection start
    const startNode = range.startContainer;
    const startOffset = range.startOffset || 0;
    const beforeText = collectTextBefore(startNode, startOffset, 4000);

    // Collect a window of text after the selection end
    function collectTextAfter(node, offset, maxChars = 4000) {
      let pieces = [];
      let remaining = maxChars;

      // If we're in a text node, take the right portion from offset
      if (node.nodeType === Node.TEXT_NODE) {
        const txt = (node.textContent || '').slice(offset);
        pieces.push(txt);
        remaining -= txt.length;
      }

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      walker.currentNode = node;
      while (remaining > 0) {
        const next = walker.nextNode();
        if (!next) break;
        const txt = next.textContent || '';
        if (!txt.trim()) continue;
        if (txt.length > remaining) {
          pieces.push(txt.slice(0, remaining));
          break;
        } else {
          pieces.push(txt);
          remaining -= txt.length;
        }
      }

      return pieces.join(' ');
    }

    const endNode = range.endContainer;
    const endOffset = range.endOffset || 0;
    const afterText = collectTextAfter(endNode, endOffset, 4000);

    // Combine before + selected + after, normalize whitespace
    const combined = (beforeText + ' ' + selectedText + ' ' + afterText).replace(/\s+/g, ' ').trim();
    if (!combined) return '';
    
    // Split the combined text into sentences
    const sentences = combined.match(/[^.!?]+[.!?]*/g) || [];
    const selectedWords = selectedText.split(/\s+/);
    
    // Find the sentence containing the selected text
    let selectedSentence = '';
    for (const sentence of sentences) {
      const normalizedSentence = sentence.replace(/\s+/g, ' ').trim();
      const containsAllWords = selectedWords.every(word =>
        normalizedSentence.includes(word)
      );
      if (containsAllWords) {
        selectedSentence = normalizedSentence;
        break;
      }
    }
    
    // Return the selected sentence or an empty string if not found
    return selectedSentence || '';

    const words = combined.split(/\s+/);
    const selectedLastToken = selectedText.split(/\s+/).pop();

    // Find the last occurrence of the selected token to find its position
    let pos = -1;
    for (let i = words.length - 1; i >= 0; i--) {
      if (words[i].replace(/[.,;:!?"'()]/g, '') === selectedLastToken.replace(/[.,;:!?"'()]/g, '')) {
        pos = i;
        break;
      }
    }
    if (pos === -1) pos = Math.max(0, Math.min(words.length - 1, beforeCount));

    const from = Math.max(0, pos - beforeCount);
    const to = Math.min(words.length - 1, pos + afterCount);
    return words.slice(from, to + 1).join(' ');
  }

