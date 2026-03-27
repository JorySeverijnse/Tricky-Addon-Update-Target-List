import { exec, spawn } from 'kernelsu-alt';
import { basePath, showPrompt, parseMarkdown } from './main.js';
import { getString } from './language.js';

const updateCard = document.getElementById('update-card');
const updateDialog = document.getElementById('update-dialog');
const closeUpdate = document.getElementById('close-update');
const releaseNotes = document.querySelector('.changelog');
const installButton = document.querySelector('.install');
const rebootButton = document.querySelector('.reboot');

let remoteVersionCode, remoteVersion, zipURL, changelogURL, downloading = false;
export let connection = true;

// Function to download file
function downloadFile(targetURL, fileName) {
    return new Promise((resolve, reject) => {
        fetch(targetURL)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.blob();
            })
            .then(blob => {
                const file = new File([blob], fileName, { type: blob.type });
                const reader = new FileReader();
                reader.onload = () => {
                    const base64Data = reader.result.split(',')[1];
                    exec(`echo ${base64Data} | base64 -d > ${basePath}/common/tmp/${fileName}`)
                        .then(({ errno, stderr }) => {
                            errno === 0 ? resolve() : reject(stderr);
                        });
                };
                reader.readAsDataURL(file);
            })
            .catch(reject);
    });
}

// Function to check for updates
export async function updateCheck() {
    console.log("updateCheck() called");
    try {
        console.log("updateCheck: Attempting to fetch from GitHub...");
        const link = "https://raw.githubusercontent.com/KOWX712/Tricky-Addon-Update-Target-List/main/update.json";
        let response = await fetch(link).catch(() => null);
        if (!response || !response.ok) {
            console.log("updateCheck: Primary fetch failed, trying CDN...");
            response = await fetch(`https://gh.sevencdn.com/${link}`);
        }
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        console.log("updateCheck: Fetch successful, status:", response.status);
        connection = true;
        const data = await response.json();
        remoteVersionCode = data.versionCode;
        remoteVersion = data.version;
        zipURL = data.zipUrl;
        changelogURL = data.changelog;

        console.log("updateCheck: Running get_extra.sh --check-update...");
        const output = spawn('sh', [`${basePath}/common/get_extra.sh`, '--check-update', `${remoteVersionCode}`]);
        output.stdout.on('data', (data) => {
            if (data.includes("update")) {
                console.log("updateCheck: Update available");
                updateCard.style.display = "flex";
                setupUpdateMenu();
            }
        });
        output.on('exit', (code) => {
            console.log("updateCheck: get_extra.sh exited with code:", code);
        });
    } catch (error) {
        console.error("Error in updateCheck():", error);
        console.error("Error name:", error.name);
        console.error("Error message:", error.message);
        console.error("Error stack:", error.stack);
        
        if (error.message.includes('fetch') || error.message.includes('network') || 
            error.message.includes('Network') || error.message.includes('Failed to fetch')) {
            console.error("Detected network error in updateCheck()");
            showPrompt(getString("prompt_no_internet"), false);
        } else if (error.message.includes('permission') || error.message.includes('Permission') ||
                   error.message.includes('ashmem') || error.message.includes('/proc/')) {
            console.error("Detected permission error in updateCheck():", error.message);
            showPrompt("Permission error: " + error.message, false);
        } else {
            console.error("Unknown error type in updateCheck():", error.message);
            showPrompt("Error checking updates: " + error.message, false);
        }
        
        connection = false;
    }
}

// Function to render changelog
function renderChangelog() {
    exec(`sh ${basePath}/common/get_extra.sh --release-note ${remoteVersion}`)
        .then(({ stdout }) => {
            const cleanedChangelog = stdout
                .split('\n')
                .filter(line => line.trim() !== '')
                .join('\n');
            parseMarkdown(releaseNotes, cleanedChangelog);
        });
}

// Function to setup update menu
function setupUpdateMenu() {
    // Update card
    updateCard.addEventListener('click', async () => {
        const { stdout } = await exec(`
            [ -f ${basePath}/common/tmp/module.zip ] || echo "noModule"
            [ -f ${basePath}/common/tmp/changelog.md ] || echo "noChangelog"
            [ ! -f /data/adb/modules/TA_utl/update ] || echo "updated"
        `);
        if (stdout.trim().includes("updated")) {
            installButton.style.display = "none";
            rebootButton.style.display = "flex";
            updateDialog.show();
        } else if (stdout.trim().includes("noChangelog")) {
            showPrompt(getString("prompt_downloading"));
            await downloadFile(changelogURL, "changelog.md");
            renderChangelog();
            updateDialog.show();
            setTimeout(() => {
                updateCard.click();
            }, 200);
        } else if (stdout.trim().includes("noModule")) {
            if (downloading) return;
            downloading = true;
            const download = spawn('sh', [`${basePath}/common/get_extra.sh`, '--get-update', `${zipURL}`],
                                { env: { PATH: "$PATH:/data/adb/ap/bin:/data/adb/ksu/bin:/data/adb/magisk:/data/data/com.termux/files/usr/bin" } });
            download.on('exit', (code) => {
                downloading = false;
                if (code === 0) {
                    showPrompt(getString("prompt_downloaded"));
                    installButton.style.display = "flex";
                } else {
                    showPrompt(getString("prompt_download_fail"), false);
                }
            });
        } else {
            installButton.style.display = "flex";
            renderChangelog();
            updateDialog.show();
        }
    });

    // Close update menu
    closeUpdate.addEventListener("click", () => updateDialog.close());

    // Install button
    installButton.addEventListener('click', async () => {
        showPrompt(getString("prompt_installing"));
        const output = spawn('sh', [`${basePath}/common/get_extra.sh`, '--install-update'],
                        { env: { PATH: "$PATH:/data/adb/ap/bin:/data/adb/ksu/bin:/data/adb/magisk" } });
        output.stderr.on('data', (data) => {
            console.error('Error during installation:', data);
        });
        output.on('exit', (code) => {
            if (code === 0) {
                showPrompt(getString("prompt_installed"));
                installButton.style.display = "none";
                rebootButton.style.display = "flex";
            } else {
                showPrompt(getString("prompt_install_fail"), false);
            }
        });
    });

    // Reboot button
    rebootButton.addEventListener('click', async () => {
        try {
            showPrompt(getString("prompt_rebooting"));
            await new Promise(resolve => setTimeout(resolve, 1000));
            await exec("svc power reboot");
        } catch (error) {
            showPrompt(getString("prompt_reboot_fail"), false);
            console.error('Fail to reboot:', error);
        }
    });
}
