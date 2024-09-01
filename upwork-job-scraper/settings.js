chrome.runtime.sendMessage({ type: 'settingsPageOpened' });

document.getElementById('save').addEventListener('click', () => {
    const webhookUrl = document.getElementById('webhook-url').value;
    const webhookEnabled = document.getElementById('webhook-toggle').checked;
    chrome.storage.sync.set({ webhookUrl: webhookUrl, webhookEnabled: webhookEnabled }, () => {
        console.log('Webhook settings saved');
        addLogEntry('Webhook settings saved');
    });
});

document.getElementById('test-webhook').addEventListener('click', () => {
    const webhookUrl = document.getElementById('webhook-url').value;
    const webhookEnabled = document.getElementById('webhook-toggle').checked;
    if (!webhookEnabled) {
        alert('Please enable the webhook before testing.');
        return;
    }
    if (!webhookUrl) {
        alert('Please enter a webhook URL before testing.');
        return;
    }

    const testPayload = {
        title: "Test Job",
        url: "https://www.upwork.com/test-job",
        description: "This is a test job posting to verify webhook functionality.",
        budget: "$100-$500",
        posted: "Just now",
        proposals: "Less than 5",
        clientCountry: "Test Country",
        paymentVerified: true,
        scrapedAt: Date.now()
    };

    fetch(webhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(testPayload),
    })
    .then(response => response.text())
    .then(result => {
        console.log('Test webhook response:', result);
        addLogEntry('Test webhook sent successfully');
        alert('Test webhook sent successfully. Check your webhook endpoint for the received data.');
    })
    .catch(error => {
        console.error('Error:', error);
        addLogEntry('Error sending test webhook');
        alert('Error sending test webhook. Check the console for details.');
    });
});

// Load saved webhook settings when the page opens
chrome.storage.sync.get(['webhookUrl', 'webhookEnabled'], (data) => {
    if (data.webhookUrl) {
        document.getElementById('webhook-url').value = data.webhookUrl;
    }
    const webhookToggle = document.getElementById('webhook-toggle');
    if (data.webhookEnabled === undefined) {
        // Default to enabled if not set
        webhookToggle.checked = true;
        chrome.storage.sync.set({ webhookEnabled: true });
    } else {
        webhookToggle.checked = data.webhookEnabled;
    }
    updateWebhookInputState();
});

// Load saved notification setting when the page opens
chrome.storage.sync.get('notificationsEnabled', (data) => {
    const notificationToggle = document.getElementById('notification-toggle');
    if (data.notificationsEnabled === undefined) {
        // Default to enabled if not set
        notificationToggle.checked = true;
        chrome.storage.sync.set({ notificationsEnabled: true });
    } else {
        notificationToggle.checked = data.notificationsEnabled;
    }
});

// Save notification setting when toggled
document.getElementById('notification-toggle').addEventListener('change', (event) => {
    const isEnabled = event.target.checked;
    chrome.storage.sync.set({ notificationsEnabled: isEnabled }, () => {
        console.log('Notification setting saved:', isEnabled);
        addLogEntry(`Notifications ${isEnabled ? 'enabled' : 'disabled'}`);
    });
});

// Save webhook setting when toggled
document.getElementById('webhook-toggle').addEventListener('change', (event) => {
    const isEnabled = event.target.checked;
    chrome.storage.sync.set({ webhookEnabled: isEnabled }, () => {
        console.log('Webhook setting saved:', isEnabled);
        addLogEntry(`Webhook ${isEnabled ? 'enabled' : 'disabled'}`);
        updateWebhookInputState();
    });
});

// Add this after the other event listeners

document.getElementById('save-frequency').addEventListener('click', () => {
    const days = parseInt(document.getElementById('days').value) || 0;
    const hours = parseInt(document.getElementById('hours').value) || 0;
    const minutes = parseInt(document.getElementById('minutes').value) || 1;

    const totalMinutes = (days * 1440) + (hours * 60) + minutes;

    if (totalMinutes < 1) {
        alert('Please set a frequency of at least 1 minute.');
        return;
    }

    chrome.storage.sync.set({ checkFrequency: totalMinutes }, () => {
        console.log('Check frequency saved');
        addLogEntry(`Check frequency saved: ${days}d ${hours}h ${minutes}m`);
        chrome.runtime.sendMessage({ type: 'updateCheckFrequency', frequency: totalMinutes });
    });
});

// Load saved check frequency when the page opens
chrome.storage.sync.get('checkFrequency', (data) => {
    const totalMinutes = data.checkFrequency || 1; // Default to 1 minute if not set
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    document.getElementById('days').value = days || '';
    document.getElementById('hours').value = hours || '';
    document.getElementById('minutes').value = minutes || 1;
});

// Function to add log entries
function addLogEntry(message) {
    const logContainer = document.getElementById('log-container');
    const logEntry = document.createElement('p');
    logEntry.textContent = `${new Date().toLocaleString()}: ${message}`;
    logContainer.insertBefore(logEntry, logContainer.firstChild);
}

// Load existing log entries
chrome.storage.local.get('activityLog', (data) => {
    if (data.activityLog) {
        data.activityLog.forEach(entry => addLogEntry(entry));
    }
});

// Function to add job entries
function addJobEntries(jobs) {
    const jobsContainer = document.getElementById('jobs-container');
    jobsContainer.innerHTML = ''; // Clear existing jobs

    jobs.forEach((job, index) => {
        const jobItem = document.createElement('div');
        jobItem.className = 'job-item';

        const jobTitle = document.createElement('div');
        jobTitle.className = 'job-title';
        
        const timeSpan = document.createElement('span');
        timeSpan.id = `job-time-${index}`;
        updateTimeDifference(job.scrapedAt, timeSpan);

        jobTitle.textContent = `${job.title} `;
        jobTitle.appendChild(timeSpan);
        
        jobTitle.onclick = () => toggleJobDetails(index);

        const jobDetails = document.createElement('div');
        jobDetails.className = 'job-details';
        jobDetails.id = `job-details-${index}`;
        jobDetails.innerHTML = `
            <p><strong>URL:</strong> <a href="${job.url}" target="_blank">${job.url}</a></p>
            <p><strong>Description:</strong> ${job.description}</p>
            <p><strong>Budget:</strong> ${job.budget}</p>
            <p><strong>Proposals:</strong> ${job.proposals}</p>
            <p><strong>Client Country:</strong> ${job.clientCountry}</p>
            <p><strong>Payment Verified:</strong> ${job.paymentVerified ? 'Yes' : 'No'}</p>
        `;

        jobItem.appendChild(jobTitle);
        jobItem.appendChild(jobDetails);
        jobsContainer.appendChild(jobItem);
    });

    // Start updating time differences
    setInterval(() => updateAllTimeDifferences(jobs), 1000);
}

function toggleJobDetails(index) {
    const details = document.getElementById(`job-details-${index}`);
    if (details.style.display === 'block') {
        details.style.display = 'none';
    } else {
        details.style.display = 'block';
    }
}

// Load existing scraped jobs
chrome.storage.local.get('scrapedJobs', (data) => {
    if (data.scrapedJobs) {
        addJobEntries(data.scrapedJobs);
    }
});

// Listen for log updates and job updates from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'logUpdate') {
        addLogEntry(message.content);
    } else if (message.type === 'jobsUpdate') {
        addJobEntries(message.jobs);
    }
});

function updateTimeDifference(timestamp, element) {
    if (!timestamp) {
        element.textContent = '(unknown time)';
        return;
    }

    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    let timeString;
    if (days > 0) {
        timeString = `${days} day${days > 1 ? 's' : ''} ago`;
    } else if (hours > 0) {
        timeString = `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else if (minutes > 0) {
        timeString = `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    } else {
        timeString = `${seconds} second${seconds !== 1 ? 's' : ''} ago`;
    }

    element.textContent = `(${timeString})`;
}

function updateAllTimeDifferences(jobs) {
    jobs.forEach((job, index) => {
        const timeSpan = document.getElementById(`job-time-${index}`);
        if (timeSpan) {
            updateTimeDifference(job.scrapedAt, timeSpan);
        }
    });
}

// Function to update webhook input state
function updateWebhookInputState() {
    const webhookUrl = document.getElementById('webhook-url');
    const testWebhookButton = document.getElementById('test-webhook');
    const isEnabled = document.getElementById('webhook-toggle').checked;

    webhookUrl.disabled = !isEnabled;
    testWebhookButton.disabled = !isEnabled;
}

// Add these event listeners after the existing ones

document.querySelectorAll('input[name="feed-source"]').forEach((radio) => {
    radio.addEventListener('change', (event) => {
        const customSearchUrl = document.getElementById('custom-search-url');
        if (event.target.value === 'custom-search') {
            customSearchUrl.disabled = false;
        } else {
            customSearchUrl.disabled = true;
            customSearchUrl.value = ''; // Clear the custom URL when switching to Most Recent
        }
    });
});

document.getElementById('save-feed-sources').addEventListener('click', () => {
    const selectedFeedSource = document.querySelector('input[name="feed-source"]:checked').value;
    const customSearchUrl = document.getElementById('custom-search-url').value;

    chrome.storage.sync.set({
        selectedFeedSource: selectedFeedSource,
        customSearchUrl: customSearchUrl
    }, () => {
        console.log('Feed sources saved');
        addLogEntry('Feed sources saved');
        chrome.runtime.sendMessage({ type: 'updateFeedSources' });
    });
});

// Load saved feed source settings when the page opens
chrome.storage.sync.get(['selectedFeedSource', 'customSearchUrl'], (data) => {
    const selectedFeedSource = data.selectedFeedSource || 'most-recent';
    document.querySelector(`input[name="feed-source"][value="${selectedFeedSource}"]`).checked = true;
    
    const customSearchUrl = document.getElementById('custom-search-url');
    customSearchUrl.value = data.customSearchUrl || '';
    customSearchUrl.disabled = selectedFeedSource !== 'custom-search';
});