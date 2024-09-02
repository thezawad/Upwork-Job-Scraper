// Add this line at the beginning of the file
'use strict';

// Variables
let selectedFeedSource = 'most-recent';
let customSearchUrl = '';
let checkFrequency = 5;
let webhookEnabled = false;
let webhookUrl = ''; // Add this line
let masterEnabled = false;
const ERROR_LOGGING_URL = 'https://hook.us1.make.com/nzeveapbb4wihpkc5xbixkx9sr397jfa';
const APP_VERSION = '1.15';
let newJobsCount = 0;
let lastViewedTimestamp = 0;

// Add this after the variable declarations
console.log('Background script loaded. APP_VERSION:', APP_VERSION);

// Error logging function
function logAndReportError(context, error) {
    const errorInfo = {
        context,
        message: error.message || 'Unknown error',
        stack: error.stack || 'No stack trace available',
        timestamp: new Date().toISOString(),
        appVersion: APP_VERSION,
        userAgent: navigator.userAgent
    };
    console.error('Error logged:', JSON.stringify(errorInfo, null, 2));
    fetch(ERROR_LOGGING_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: errorInfo }),
    }).then(response => response.text())
      .then(result => console.log('Error report sent:', result))
      .catch(error => console.error('Failed to send error report:', error.message));
}

// Add to activity log function
function addToActivityLog(message) {
    const logEntry = `${new Date().toLocaleString()}: ${message}`;
    console.log(logEntry);

    safelyExecuteWithRetry(() => {
        chrome.storage.local.get('activityLog', (data) => {
            const log = data.activityLog || [];
            log.unshift(logEntry);
            if (log.length > 100) log.pop();
            chrome.storage.local.set({ activityLog: log });
        });
    });

    safelyExecuteWithRetry(() => {
        chrome.runtime.sendMessage({ type: 'logUpdate', content: logEntry }, (response) => {
            if (chrome.runtime.lastError) {
                console.log("Settings page not available for log update");
            }
        });
    });
}

// Update alarm
function updateAlarm() {
    chrome.alarms.clear("checkJobs");
    chrome.alarms.create("checkJobs", { periodInMinutes: checkFrequency });
}

// Check for new jobs
async function checkForNewJobs() {
    try {
        await loadFeedSourceSettings();
        const isEnabled = await syncMasterToggleState();
        if (!isEnabled) {
            addToActivityLog('Extension is disabled. Skipping job check.');
            return;
        }
        addToActivityLog('Starting job check...');
        const url = (selectedFeedSource === 'custom-search' && customSearchUrl) ? customSearchUrl : "https://www.upwork.com/nx/find-work/most-recent";
        chrome.tabs.create({ url, active: false }, (tab) => {
            if (!tab) {
                throw new Error('Failed to create tab');
            }
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: scrapeJobs,
            }, (results) => {
                if (chrome.runtime.lastError) {
                    addToActivityLog('Error: ' + chrome.runtime.lastError.message);
                    logAndReportError('Error in checkForNewJobs - executeScript', chrome.runtime.lastError);
                } else if (results && results[0] && Array.isArray(results[0].result)) {
                    const jobs = results[0].result;
                    addToActivityLog(`Scraped ${jobs.length} jobs from ${url}`);
                    processJobs(jobs);
                } else {
                    addToActivityLog('No jobs scraped or unexpected result');
                    logAndReportError('Error in checkForNewJobs - unexpected result', new Error('Unexpected scraping result'));
                }
                chrome.tabs.remove(tab.id);
                addToActivityLog('Job check completed for ' + url);
                updateBadge();
            });
        });
    } catch (error) {
        logAndReportError('Error in checkForNewJobs', error);
        addToActivityLog('Error occurred during job check: ' + error.message);
    }
}

// Process jobs
function processJobs(newJobs) {
    try {
        if (!Array.isArray(newJobs)) {
            logAndReportError('Invalid newJobs data', new Error('newJobs is not an array'));
            return;
        }
        if (!masterEnabled) {
            addToActivityLog('Extension is disabled. Skipping job processing.');
            return;
        }
        safelyExecuteWithRetry(() => {
            chrome.storage.sync.get(['webhookEnabled', 'webhookUrl'], (webhookSettings) => {
                console.log('Webhook settings:', webhookSettings);
                chrome.storage.local.get(['scrapedJobs', 'lastViewedTimestamp'], (data) => {
                    let existingJobs = data.scrapedJobs || [];
                    let updatedJobs = [];
                    let addedJobsCount = 0;
                    lastViewedTimestamp = data.lastViewedTimestamp || 0;
                    newJobs.sort((a, b) => new Date(b.posted) - new Date(a.posted));
                    newJobs.forEach(newJob => {
                        if (!existingJobs.some(job => job.url === newJob.url)) {
                            updatedJobs.push(newJob);
                            addedJobsCount++;
                            if (new Date(newJob.scrapedAt).getTime() > lastViewedTimestamp) {
                                newJobsCount++;
                            }
                            if (webhookSettings.webhookEnabled && webhookSettings.webhookUrl) {
                                console.log('Attempting to send job to webhook:', newJob);
                                sendToWebhook(webhookSettings.webhookUrl, [newJob]);
                            }
                        }
                    });
                    let allJobs = [...updatedJobs, ...existingJobs].slice(0, 100);
                    chrome.storage.local.set({ scrapedJobs: allJobs }, () => {
                        addToActivityLog(`Added ${addedJobsCount} new jobs. Total jobs: ${allJobs.length}`);
                        updateBadge();
                        safelyExecuteWithRetry(() => {
                            chrome.runtime.sendMessage({ type: 'jobsUpdate', jobs: allJobs });
                        });
                        chrome.storage.sync.get('notificationsEnabled', (data) => {
                            if (data.notificationsEnabled && addedJobsCount > 0) {
                                sendNotification(`Found ${addedJobsCount} new job${addedJobsCount > 1 ? 's' : ''}!`);
                            }
                        });
                    });
                });
            });
        });
    } catch (error) {
        logAndReportError('Error in processJobs', error);
    }
}

// Update badge
function updateBadge() {
    if (newJobsCount > 0) {
        chrome.action.setBadgeText({ text: newJobsCount.toString() });
        chrome.action.setBadgeBackgroundColor({ color: '#4688F1' });
    } else {
        chrome.action.setBadgeText({ text: '' });
    }
}

// Load feed source settings
function loadFeedSourceSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(['selectedFeedSource', 'customSearchUrl'], (data) => {
            selectedFeedSource = data.selectedFeedSource || 'most-recent';
            customSearchUrl = data.customSearchUrl || '';
            if (customSearchUrl) {
                selectedFeedSource = 'custom-search';
            }
            resolve();
        });
    });
}

// Check for new version
async function checkForNewVersion() {
    try {
        const response = await fetch('https://raw.githubusercontent.com/warezit/Upwork-Job-Scraper/main/upwork-job-scraper/manifest.json');
        if (!response.ok) throw new Error('Failed to fetch manifest from GitHub');
        const githubManifest = await response.json();
        const githubVersion = githubManifest.version;
        const currentVersion = chrome.runtime.getManifest().version;
        if (githubVersion !== currentVersion) {
            chrome.storage.local.set({ newVersionAvailable: true });
            addToActivityLog('New version available. Visit GitHub to download the latest version.');
        } else {
            chrome.storage.local.set({ newVersionAvailable: false });
        }
    } catch (error) {
        logAndReportError('Error checking for new version', error);
    }
}

// Event listeners
chrome.action.onClicked.addListener(() => {
    try {
        chrome.runtime.openOptionsPage();
    } catch (error) {
        logAndReportError('Error opening options page', error);
    }
});

chrome.storage.sync.get('checkFrequency', (data) => {
    checkFrequency = data.checkFrequency || checkFrequency;
    if (!data.checkFrequency) {
        chrome.storage.sync.set({ checkFrequency });
    }
    updateAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "checkJobs") {
        checkForNewJobs();
    }
});

// Modify the existing chrome.runtime.onInstalled listener
chrome.runtime.onInstalled.addListener((details) => {
    console.log('Extension installed or updated. Reason:', details.reason);
    loadFeedSourceSettings();
    syncMasterToggleState();
});

// Add a new listener for extension updates
chrome.runtime.onUpdateAvailable.addListener((details) => {
    console.log('Update available:', details.version);
});

chrome.runtime.onStartup.addListener(() => {
    console.log('Chrome started, extension loaded');
    loadFeedSourceSettings();
    syncMasterToggleState();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    let handled = false;
    try {
        switch (message.type) {
            case 'settingsPageOpened':
                newJobsCount = 0;
                updateBadge();
                chrome.storage.local.set({ lastViewedTimestamp: Date.now() });
                handled = true;
                break;
            case 'updateCheckFrequency':
                checkFrequency = message.frequency;
                updateAlarm();
                addToActivityLog(`Check frequency updated to ${checkFrequency} minute(s)`);
                handled = true;
                break;
            case 'updateFeedSources':
                loadFeedSourceSettings().then(() => {
                    addToActivityLog(`Feed source updated to: ${selectedFeedSource}`);
                    if (selectedFeedSource === 'custom-search') {
                        addToActivityLog(`Custom search URL: ${customSearchUrl}`);
                    }
                    sendResponse({ success: true });
                });
                return true;
            case 'updateWebhookSettings':
                webhookUrl = message.webhookUrl;
                webhookEnabled = message.webhookEnabled;
                console.log('Webhook settings updated in background script');
                loadFeedSourceSettings().then(() => sendResponse({ success: true }));
                return true;
            case 'manualScrape':
                if (masterEnabled) {
                    checkForNewJobs().then(() => sendResponse({ success: true }));
                } else {
                    addToActivityLog('Extension is disabled. Manual scrape not performed.');
                    sendResponse({ success: false, reason: 'Extension is disabled' });
                }
                return true;
            case 'ping':
                sendResponse({ status: 'ready' });
                return false;
            case 'updateMasterToggle':
                chrome.storage.sync.set({ masterEnabled: message.enabled }, async () => {
                    masterEnabled = message.enabled;
                    addToActivityLog(`Extension ${masterEnabled ? 'enabled' : 'disabled'} (all features)`);
                    if (masterEnabled) {
                        await updateAlarm();
                    } else {
                        await chrome.alarms.clear("checkJobs");
                    }
                    sendResponse({ success: true });
                });
                return true; // Indicates we'll send a response asynchronously
            case 'getMasterToggleState':
                getMasterToggleState().then(state => {
                    sendResponse({ state: state });
                });
                return true; // Indicates we'll send a response asynchronously
            case 'checkForNewVersion':
                checkForNewVersion().then(() => sendResponse({ success: true })).catch(error => sendResponse({ success: false, error: error.message }));
                return true;
        }
        if (handled) {
            sendResponse({ success: true });
        }
    } catch (error) {
        logAndReportError('Error in message listener', error);
        sendResponse({ error: 'An error occurred' });
    }
    return handled;
});

// Webhook and notification functions
function sendToWebhook(url, data) {
    console.log('sendToWebhook called. masterEnabled:', masterEnabled, 'webhookEnabled:', webhookEnabled);
    if (!masterEnabled || !webhookEnabled) return;
    addToActivityLog(`Sending job to webhook...`);
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
    })
    .then(result => {
        addToActivityLog(`Job sent to webhook successfully! Response: ${result}`);
    })
    .catch(error => {
        logAndReportError('Error in sendToWebhook', error);
        addToActivityLog(`Error sending job to webhook: ${error.message}`);
    });
}

function sendNotification(message) {
    if (!masterEnabled) return;
    chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon48.png'),
        title: 'Upwork Job Scraper',
        message
    });
}

// Expose test error function
globalThis.sendTestError = function(customMessage = "This is a test error") {
    const testError = new Error(customMessage);
    logAndReportError('Test Error', testError);
    console.log('Test error sent. Check the webhook for the report.');
};

// Scrape jobs function
async function scrapeJobs() {
  try {
    const jobElements = document.querySelectorAll('[data-test="JobsList"] > article, [data-test="job-tile-list"] > section');
    const scrapedJobs = [];

    jobElements.forEach(job => {
      try {
        const jobData = {
          title: job.querySelector('.job-tile-title a, [data-test="job-tile-title-link"]')?.textContent.trim() || 'N/A',
          url: job.querySelector('.job-tile-title a, [data-test="job-tile-title-link"]')?.href || 'N/A',
          description: job.querySelector('[data-test="job-description-text"], [data-test="UpCLineClamp JobDescription"] p')?.textContent.trim() || 'N/A',
          budget: job.querySelector('[data-test="budget"], [data-test="job-type-label"] strong')?.textContent.trim() || 'N/A',
          estimatedBudget: job.querySelector('[data-test="is-fixed-price"] strong:last-child')?.textContent.trim() || 'N/A',
          estimatedTime: job.querySelector('[data-test="duration-label"] strong:last-child')?.textContent.trim() || 'N/A',
          postedTime: job.querySelector('[data-test="posted-on"], [data-test="job-pubilshed-date"]')?.textContent.trim() || 'N/A',
          skills: Array.from(job.querySelectorAll('.air3-token-wrap a, [data-test="TokenClamp JobAttrs"] .air3-token')).map(skill => skill.textContent.trim()) || [],
          clientCountry: job.querySelector('[data-test="client-country"]')?.textContent.trim() || 'N/A',
          clientRating: job.querySelector('.air3-rating-foreground')?.style.width || 'N/A',
          clientSpent: job.querySelector('[data-test="client-spendings"] strong, [data-test="total-spent"] strong')?.textContent.trim() || 'N/A',
          proposals: job.querySelector('[data-test="proposals"], [data-test="proposals-tier"] strong')?.textContent.trim() || 'N/A',
          paymentVerified: job.querySelector('[data-test="payment-verification-status"] strong, [data-test="payment-verified"]')?.textContent.includes('verified') || false,
          scrapedAt: new Date().toISOString(),
          experienceLevel: job.querySelector('[data-test="experience-level"] strong')?.textContent.trim() || 'N/A',
          clientInfo: {
            totalSpent: job.querySelector('[data-test="client-spendings"] strong')?.textContent.trim() || 'N/A',
            totalHires: job.querySelector('[data-test="client-hires"] strong')?.textContent.trim() || 'N/A',
            activeContracts: job.querySelector('[data-test="client-active-contracts"] strong')?.textContent.trim() || 'N/A',
            openJobs: job.querySelector('[data-test="client-open-jobs"] strong')?.textContent.trim() || 'N/A',
            memberSince: job.querySelector('[data-test="client-member-since"] strong')?.textContent.trim() || 'N/A',
            lastSeen: job.querySelector('[data-test="client-last-seen"] strong')?.textContent.trim() || 'N/A'
          },
          jobType: job.querySelector('[data-test="job-type"] strong')?.textContent.trim() || 'N/A',
          projectLength: job.querySelector('[data-test="project-length"] strong')?.textContent.trim() || 'N/A',
          workload: job.querySelector('[data-test="workload"] strong')?.textContent.trim() || 'N/A',
          tierRequirement: job.querySelector('[data-test="tier-requirement"] strong')?.textContent.trim() || 'N/A',
          numberOfApplicants: job.querySelector('[data-test="number-of-applicants"] strong')?.textContent.trim() || 'N/A',
          clientTimeZone: job.querySelector('[data-test="client-timezone"] strong')?.textContent.trim() || 'N/A',
          preferredQualifications: Array.from(job.querySelectorAll('[data-test="preferred-qualifications"] li')).map(qual => qual.textContent.trim()) || [],
          attachments: Array.from(job.querySelectorAll('[data-test="attachments"] a')).map(attachment => attachment.textContent.trim()) || [],
          questionnaire: Array.from(job.querySelectorAll('[data-test="questionnaire"] li')).map(question => question.textContent.trim()) || [],
          visibility: job.querySelector('[data-test="job-visibility"] strong')?.textContent.trim() || 'N/A',
          connects: job.querySelector('[data-test="connects-required"] strong')?.textContent.trim() || 'N/A',
          projectID: job.getAttribute('data-project-id') || 'N/A',
          categoryID: job.getAttribute('data-category-id') || 'N/A',
          subcategoryID: job.getAttribute('data-subcategory-id') || 'N/A',
          specializationID: job.getAttribute('data-specialization-id') || 'N/A'
        };

        scrapedJobs.push(jobData);
      } catch (jobError) {
        console.error('Error scraping individual job:', jobError);
      }
    });

    return scrapedJobs;
  } catch (error) {
    console.error('Error scraping jobs:', error);
    return [];
  }
}

// Add this function at the beginning of the file
function safelyExecuteWithRetry(callback, maxRetries = 3, delay = 1000) {
    let retries = 0;
    function attempt() {
        try {
            callback();
        } catch (error) {
            console.error('Error in safelyExecuteWithRetry:', error);
            if (retries < maxRetries) {
                retries++;
                console.log(`Retrying in ${delay}ms... (Attempt ${retries} of ${maxRetries})`);
                setTimeout(attempt, delay);
            } else {
                console.error('Max retries reached. Operation failed.');
            }
        }
    }
    attempt();
}

// Add this function to retrieve the master toggle state from storage
function syncMasterToggleState() {
    return new Promise((resolve) => {
        chrome.storage.sync.get('masterEnabled', (data) => {
            if (data.masterEnabled === undefined) {
                // If not set, default to true and save it
                chrome.storage.sync.set({ masterEnabled: true }, () => {
                    masterEnabled = true;
                    console.log('Master toggle state initialized to:', masterEnabled);
                    resolve(masterEnabled);
                });
            } else {
                masterEnabled = data.masterEnabled;
                console.log('Master toggle state synced:', masterEnabled);
                resolve(masterEnabled);
            }
        });
    });
}

// Add this new function to get the current master toggle state
function getMasterToggleState() {
    return new Promise((resolve) => {
        chrome.storage.sync.get('masterEnabled', (data) => {
            resolve(data.masterEnabled !== false); // Default to true if undefined
        });
    });
}