document.addEventListener('DOMContentLoaded', () => {
  const uploadForm = document.getElementById('uploadForm');
  const dropArea = document.getElementById('drop-area');
  const fileElem = document.getElementById('fileElem');
  const fileInfo = document.getElementById('file-info');
  const statusDiv = document.getElementById('status');
  const resultDiv = document.getElementById('result');
  const maxSizeSlider = document.getElementById('maxSize');
  const sizeValueSpan = document.getElementById('sizeValue');
  const compressBtn = document.getElementById('compressBtn');
  const progressContainer = document.getElementById('progress-container');
  const progressBarInner = document.getElementById('progress-bar-inner');
  const progressText = document.getElementById('progress-text');
  const uploadLimitText = document.getElementById('upload-limit-text');
  
  let selectedFile = null;
  let eventSource = null;
  let maxUploadSizeBytes = 0;
  let maxUploadSizeString = '';

  const parseSizeToBytes = (sizeStr) => {
      const size = parseFloat(sizeStr);
      const unit = sizeStr.toUpperCase().slice(-1);
      switch (unit) {
          case 'G': return size * 1024 * 1024 * 1024;
          case 'M': return size * 1024 * 1024;
          case 'K': return size * 1024;
          default: return size;
      }
  };
  
  fetch('/config')
    .then(response => response.json())
    .then(config => {
      if (config.maxUploadSize) {
        maxUploadSizeString = config.maxUploadSize;
        maxUploadSizeBytes = parseSizeToBytes(maxUploadSizeString);
        uploadLimitText.textContent = `Maximum upload size: ${maxUploadSizeString}`;
      }
    })
    .catch(error => {
      console.error('Error fetching server config:', error);
      uploadLimitText.textContent = 'Could not load upload limit.';
    });

  function resetUI() {
    compressBtn.disabled = false;
    progressContainer.hidden = true;
    progressContainer.classList.remove('uploading');
    progressBarInner.style.width = '0%';
    progressText.textContent = '0%';
    statusDiv.innerHTML = '';
    resultDiv.innerHTML = '';
  }

  function updateProgress(percent, statusText) {
    const percentage = Math.round(percent);
    progressBarInner.style.width = `${percentage}%`;
    progressText.textContent = `${statusText}... ${percentage}%`;
  }

  maxSizeSlider.addEventListener('input', (e) => sizeValueSpan.textContent = `${e.target.value} MB`);
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => dropArea.addEventListener(eventName, e => { e.preventDefault(); e.stopPropagation(); }));
  ['dragenter', 'dragover'].forEach(eventName => dropArea.addEventListener(eventName, () => dropArea.classList.add('highlight')));
  ['dragleave', 'drop'].forEach(eventName => dropArea.addEventListener(eventName, () => dropArea.classList.remove('highlight')));
  dropArea.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    fileElem.files = files;
    handleFiles(files);
  });
  fileElem.addEventListener('change', (e) => handleFiles(e.target.files));

  function handleFiles(files) {
    if (files.length > 0) {
      selectedFile = files[0];
      fileInfo.innerHTML = `<p>File: <strong>${selectedFile.name}</strong> (${(selectedFile.size / 1024 / 1024).toFixed(2)} MB)</p>`;
      resetUI();

      if (maxUploadSizeBytes > 0 && selectedFile.size > maxUploadSizeBytes) {
        statusDiv.innerHTML = `<p class="error">❌ File is too large. Maximum size is ${maxUploadSizeString}.</p>`;
        compressBtn.disabled = true;
        return;
      }
    }
  }

  uploadForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!selectedFile) {
      alert('Please select a video file first.');
      return;
    }

    if (maxUploadSizeBytes > 0 && selectedFile.size > maxUploadSizeBytes) {
        alert(`File is too large. Maximum size is ${maxUploadSizeString}.`);
        return;
    }

    resetUI();
    progressContainer.hidden = false;
    progressContainer.classList.add('uploading');
    compressBtn.disabled = true;

    const formData = new FormData();
    formData.append('video', selectedFile);
    formData.append('maxSize', maxSizeSlider.value);

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const percentComplete = (event.loaded / event.total) * 100;
        updateProgress(percentComplete, 'Uploading');
      }
    });

    xhr.addEventListener('load', () => {
      progressContainer.classList.remove('uploading');
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);
        updateProgress(0, 'Compressing');
        startProgressStream(data.jobId);
      } else {
        try {
          const errorData = JSON.parse(xhr.responseText);
          statusDiv.innerHTML = `<p class="error">❌ Upload Error: ${errorData.error}</p>`;
        } catch {
          statusDiv.innerHTML = `<p class="error">❌ Upload Error: ${xhr.statusText}</p>`;
        }
        resetUI();
      }
    });

    xhr.addEventListener('error', () => {
      statusDiv.innerHTML = '<p class="error">❌ A network error occurred during upload.</p>';
      resetUI();
    });

    xhr.open('POST', '/upload', true);
    xhr.send(formData);
  });

  function startProgressStream(jobId) {
    eventSource = new EventSource(`/stream/${jobId}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'progress') {
        updateProgress(data.value, 'Compressing');
      } else if (data.type === 'done') {
        statusDiv.innerHTML = '<p class="success">✅ Compression successful!</p>';
        resultDiv.innerHTML = `<a href="${data.downloadUrl}" class="download-btn" download>Download Compressed Video</a>`;
        eventSource.close();
      } else if (data.type === 'error') {
        statusDiv.innerHTML = `<p class="error">❌ Compression Error: ${data.message}</p>`;
        eventSource.close();
      }
    };

    eventSource.onerror = () => {
      statusDiv.innerHTML = '<p class="error">❌ Connection to server lost.</p>';
      eventSource.close();
    };
  }

  const themeMenuBtn = document.getElementById('theme-menu-btn');
  const themeDropdown = document.getElementById('theme-dropdown');
  const themeOptions = {
    light: document.getElementById('theme-light'),
    dark: document.getElementById('theme-dark'),
    system: document.getElementById('theme-system')
  };

  themeMenuBtn.addEventListener('click', () => {
    themeDropdown.classList.toggle('show');
  });

  window.addEventListener('click', (e) => {
    if (!themeMenuBtn.contains(e.target) && !themeDropdown.contains(e.target)) {
      themeDropdown.classList.remove('show');
    }
  });

  function applyTheme(theme) {
    document.documentElement.classList.remove('light-theme', 'dark-theme');
    if (theme === 'light' || theme === 'dark') {
      localStorage.setItem('theme', theme);
      document.documentElement.classList.add(`${theme}-theme`);
    } else {
      localStorage.removeItem('theme');
    }
    Object.values(themeOptions).forEach(btn => btn.classList.remove('active'));
    themeOptions[theme].classList.add('active');
    themeDropdown.classList.remove('show');
  }

  Object.entries(themeOptions).forEach(([themeName, btn]) => {
    btn.addEventListener('click', () => applyTheme(themeName));
  });

  const savedTheme = localStorage.getItem('theme') || 'system';
  applyTheme(savedTheme);
});
