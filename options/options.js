// options.js - manage extension options

const colorInput = document.getElementById('color');
const saveButton = document.getElementById('save');
const savedMessage = document.getElementById('saved');

function showSavedMessage() {
  savedMessage.classList.remove('hidden');
  setTimeout(() => savedMessage.classList.add('hidden'), 1200);
}

async function restoreOptions() {
  const { highlightColor } = await chrome.storage.sync.get({ highlightColor: '#fff3cd' });
  colorInput.value = highlightColor;
}

async function saveOptions() {
  await chrome.storage.sync.set({ highlightColor: colorInput.value });
  showSavedMessage();
}

saveButton.addEventListener('click', saveOptions);

restoreOptions();
