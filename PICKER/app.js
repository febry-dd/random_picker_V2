let entries = initialEntries; // Daftar peserta awal dari PHP
let availableEntries = [...entries]; // Salinan daftar peserta yang bisa diputar
let isSpinning = false; // Status apakah sedang dalam sesi putaran (multiple spins)
let currentSpinCount = 0; // Jumlah putaran yang sudah dilakukan dalam sesi ini
let totalSpins = 0; // Total putaran yang akan dilakukan dalam sesi ini
let allWinners = []; // Array untuk menyimpan semua pemenang dalam sesi ini
let selectedWinnerCount = 0; // Jumlah pemenang yang dipilih untuk sesi ini
let selectedPrizeName = ""; // Nama hadiah yang sedang diundi
const pendingWinnersBackupKey = "random_picker_pending_winners";
let isWheelSpinning = false; // Status apakah roda sedang berputar
let stopRequested = false; // Status apakah permintaan berhenti sudah dikirim
let animationId = null; // ID untuk animation frame
let currentRotation = 0; // Rotasi saat ini dari roda (dalam radian)
let currentSpeed = 0; // Kecepatan putaran saat ini
let isDecelerating = false; // Status apakah roda sedang melambat
let decelerationFactor = 0.97; // Faktor perlambatan roda
let wheelSound = null; // Objek audio untuk suara roda berputar
let winSound = null; // Objek audio untuk suara kemenangan
let audioUnlocked = false; // Flag untuk status unlock audio (browser restriction)
let winnerModalOpen = false;

function showWinnerModal(winner) {
  const modal = document.getElementById("winnerModal");
  const winnerName = document.getElementById("winnerName");

  winnerModalOpen = true; // ✅ KUNCI MODAL

  winnerName.classList.remove("multiple-winners");
  winnerName.innerHTML = selectedPrizeName
    ? `<div class="winner-prize">${escapeHtml(selectedPrizeName)}</div><div>${escapeHtml(winner)}</div>`
    : escapeHtml(winner);
  modal.classList.add("show");

  setTimeout(() => playWinSound(), 300);
  createConfetti();
}

// Cache untuk performa rendering roda
let wheelCache = {
  radius: 0, // Radius roda
  centerX: 0, // Posisi X tengah roda
  centerY: 0, // Posisi Y tengah roda
  segments: [], // Array segment roda yang sudah di-precalculate
};

// ============================================
// KONFIGURASI CANVAS & RODA
// ============================================
const canvas = document.getElementById("wheel"); // Canvas untuk roda
const ctx = canvas.getContext("2d"); // Context 2D untuk menggambar
const colors = ["#20c997", "#ffca3a", "#ff5d5d", "#4dabf7", "#8b5cf6", "#ff8a3d"]; // Warna segment roda

// Offscreen canvas untuk double buffering (mencegah flicker)
let offscreenCanvas = document.createElement("canvas");
let offscreenCtx = offscreenCanvas.getContext("2d");

// ============================================
// FUNGSI BANTUAN UMUM
// ============================================

let seedString = null;
let seedNumber = null;
let seededRandom = null;

function hashSeed(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = Math.imul(31, hash) + str.charCodeAt(i);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function () {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function initSeededRandom() {
  // Tambahkan Math.random() untuk menciptakan seed yang benar-benar unik
  const randomComponent = Math.random().toString(36).substring(2, 15);
  const msComponent = new Date().getTime();
  seedString = `EVENT-${msComponent}-${availableEntries.length}-${randomComponent}`;
  seedNumber = hashSeed(seedString);
  seededRandom = mulberry32(seedNumber);

  console.log("🔐 SEED STRING:", seedString);
  console.log("🔢 SEED NUMBER:", seedNumber);
}

/**
 * Escape HTML untuk mencegah XSS (Cross-Site Scripting)
 * @param {string} text - Teks yang akan di-escape
 * @returns {string} - Teks yang sudah aman dari HTML
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function getResultLabel(winner, prizeName = selectedPrizeName) {
  return prizeName ? `${winner} - ${prizeName}` : winner;
}

function savePendingWinnersBackup(winners) {
  try {
    const prizeName = selectedPrizeName;
    const payload = {
      prizeName,
      winners,
      labels: winners.map((winner) => getResultLabel(winner, prizeName)),
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(pendingWinnersBackupKey, JSON.stringify(payload));
  } catch (error) {
    console.warn("Gagal membuat pending backup di browser:", error);
  }
}

function clearPendingWinnersBackup() {
  try {
    localStorage.removeItem(pendingWinnersBackupKey);
  } catch (error) {
    console.warn("Gagal menghapus pending backup di browser:", error);
  }
}

async function recoverPendingWinnersBackup() {
  let pending = null;
  try {
    const raw = localStorage.getItem(pendingWinnersBackupKey);
    if (!raw) return;
    pending = JSON.parse(raw);
  } catch (error) {
    clearPendingWinnersBackup();
    return;
  }

  if (!pending || !Array.isArray(pending.winners) || pending.winners.length === 0) {
    clearPendingWinnersBackup();
    return;
  }

  console.log("🔁 Memulihkan pending winner backup:", pending);
  let lastResponse = null;
  for (let i = 0; i < pending.winners.length; i++) {
    const winner = pending.winners[i];
    const label = pending.labels?.[i] || getResultLabel(winner, pending.prizeName || "");
    lastResponse = await addResultToServer(winner, false, label);
  }

  if (lastResponse) {
    updateResultsList(lastResponse.results);
    if (lastResponse.entries) {
      entries = lastResponse.entries;
      availableEntries = [...lastResponse.entries];
      updateEntriesList(lastResponse.entries);
      if (availableEntries.length > 0) {
        drawWheel(0);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    clearPendingWinnersBackup();
    updateManualStatus("✅ Backup hasil terakhir sudah dipulihkan", "#4caf50");
  }
}

// ============================================
// PREPARE WHEEL CACHE - Optimasi Rendering
// ============================================

/**
 * Mempersiapkan cache untuk rendering roda
 * Pre-calculate semua properti segment untuk performa optimal
 */
function prepareWheelCache() {
  const centerX = canvas.width / 2; // Posisi horizontal tengah canvas
  const centerY = canvas.height / 2; // Posisi vertikal tengah canvas
  const radius = canvas.width / 2; // Radius roda (setengah lebar canvas)

  // Simpan properti dasar ke cache
  wheelCache = {
    radius: radius,
    centerX: centerX,
    centerY: centerY,
    segments: [], // Array untuk menyimpan data segment
  };

  // Hitung sudut untuk setiap segment
  const sliceAngle = (2 * Math.PI) / availableEntries.length;

  // Pre-calculate semua segment
  for (let i = 0; i < availableEntries.length; i++) {
    const startAngle = i * sliceAngle; // Sudut awal segment
    const endAngle = startAngle + sliceAngle; // Sudut akhir segment

    // Simpan data segment ke cache
    wheelCache.segments.push({
      startAngle: startAngle,
      endAngle: endAngle,
      color: colors[i % colors.length], // Warna berdasarkan index (berulang)
      text: availableEntries[i], // Nama peserta
    });
  }

  // Setup offscreen canvas untuk double buffering
  offscreenCanvas.width = canvas.width;
  offscreenCanvas.height = canvas.height;
}

// ============================================
// INISIALISASI AUDIO RODA DAN KEMENANGAN
// ============================================

/**
 * Inisialisasi sistem audio untuk roda dan suara kemenangan
 * Mengatasi browser autoplay restrictions
 */
function initializeWheelSound() {
  wheelSound = document.getElementById("wheelSound"); // Suara roda berputar
  winSound = document.getElementById("winSound"); // Suara saat menang

  console.log("🔊 Menginisialisasi audio...");

  // Inisialisasi suara roda
  if (wheelSound) {
    // Mute dulu untuk bypass autoplay restriction
    wheelSound.muted = true;
    wheelSound.volume = 0.7;

    // Coba play untuk "unlock" audio (akan di-pause segera)
    wheelSound
      .play()
      .then(() => {
        wheelSound.pause();
        wheelSound.currentTime = 0;
        wheelSound.muted = false; // Unmute setelah berhasil
        console.log("✅ Suara roda siap digunakan");
      })
      .catch((e) => {
        console.log("⚠️ Autoplay suara roda diblokir, perlu interaksi user");
      });
  }

  // Inisialisasi suara kemenangan
  if (winSound) {
    winSound.muted = true; // Mute awal untuk bypass restriction
    winSound.volume = 0.8;
    winSound.load(); // Pre-load audio
    console.log("✅ Suara kemenangan pre-loaded (muted)");
  }

  // Setup sistem untuk unlock audio saat user berinteraksi
  setupAudioUnlocker();
}

/**
 * Setup sistem untuk unlock audio setelah user berinteraksi
 * Mengatasi browser autoplay policies
 */
function setupAudioUnlocker() {
  console.log("🔓 Menyiapkan audio unlocker...");

  const unlockAudio = () => {
    if (audioUnlocked) return; // Sudah di-unlock

    console.log("👆 Interaksi user terdeteksi, membuka kunci audio...");

    // Unlock suara roda
    if (wheelSound && wheelSound.muted) {
      wheelSound.muted = false;
      console.log("✅ Suara roda di-unmute");
    }

    // Unlock suara kemenangan
    if (winSound && winSound.muted) {
      winSound.muted = false;

      // Play lalu pause untuk unlock audio context
      winSound
        .play()
        .then(() => {
          winSound.pause();
          winSound.currentTime = 0;
          console.log("✅ Suara kemenangan berhasil di-unlock");
          audioUnlocked = true; // Set flag sudah di-unlock
        })
        .catch((e) => {
          console.log("⚠️ Gagal unlock suara kemenangan:", e.message);
          audioUnlocked = true; // Tetap set flag agar bisa dicoba lagi
        });
    }

    // Hapus event listeners setelah berhasil unlock
    events.forEach((event) => {
      document.removeEventListener(event, unlockAudio);
    });
  };

  // Event listeners untuk berbagai jenis interaksi user
  const events = ["click", "keydown", "touchstart", "mousedown"];

  // Tambahkan event listener sekali saja untuk setiap event
  events.forEach((event) => {
    document.addEventListener(event, unlockAudio, {
      once: true, // Hanya sekali
      passive: true, // Optimasi performa
    });
  });

  // Juga unlock saat tombol spin diklik
  const spinButtons = document.querySelectorAll(".winner-count-btn, .btn-start, .btn-stop");
  spinButtons.forEach((button) => {
    button.addEventListener("click", unlockAudio, { once: true });
  });
}

/**
 * Memutar suara kemenangan dengan retry mechanism
 * Mengatasi berbagai issue playback audio
 */
function playWinSound() {
  if (!winSound) {
    console.error("❌ Element suara kemenangan tidak ditemukan!");
    return;
  }

  console.log("▶️ Mencoba memutar suara kemenangan...");

  // Reset audio ke awal
  winSound.currentTime = 0;
  winSound.volume = 0.8;

  // Pastikan tidak muted
  if (winSound.muted) {
    console.log("🔇 Suara kemenangan masih muted, mencoba unmute...");
    winSound.muted = false;
  }

  // Coba play audio
  const playPromise = winSound.play();

  if (playPromise !== undefined) {
    playPromise
      .then(() => {
        console.log("🎉 BERHASIL: Suara kemenangan diputar!");
      })
      .catch((error) => {
        console.log("❌ Gagal memutar suara kemenangan:", error.name);

        // Retry dengan delay kecil
        setTimeout(() => {
          console.log("🔄 Mencoba ulang suara kemenangan...");
          winSound.currentTime = 0;
          winSound
            .play()
            .then(() => console.log("✅ Percobaan ulang berhasil"))
            .catch((e) => {
              console.log("❌ Percobaan ulang gagal, mencoba fallback...");
              // Fallback: buat element audio baru
              const fallbackAudio = new Audio("sound/won.mp3");
              fallbackAudio.volume = 0.8;
              fallbackAudio
                .play()
                .then(() => console.log("✅ Audio fallback berhasil diputar"))
                .catch((e2) => console.log("❌ Semua percobaan audio gagal"));
            });
        }, 100);
      });
  }
}

// ============================================
// FUNGSI RENDERING RODA
// ============================================

/**
 * Menggambar roda dengan rotasi tertentu (versi normal)
 * Menggunakan offscreen canvas untuk smooth animation
 * @param {number} rotation - Rotasi dalam radian
 */
function drawWheel(rotation = 0) {
  const { centerX, centerY, radius } = wheelCache;

  // Bersihkan offscreen canvas
  offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);

  const sliceAngle = (2 * Math.PI) / availableEntries.length;

  // Gambar semua segment dengan rotasi
  for (let i = 0; i < availableEntries.length; i++) {
    const startAngle = i * sliceAngle + rotation;
    const endAngle = startAngle + sliceAngle;
    const middleAngle = startAngle + sliceAngle / 2;

    // Gambar segment (potongan roda)
    offscreenCtx.beginPath();
    offscreenCtx.moveTo(centerX, centerY);
    offscreenCtx.arc(centerX, centerY, radius, startAngle, endAngle);
    offscreenCtx.closePath();
    offscreenCtx.fillStyle = colors[i % colors.length];
    offscreenCtx.fill();

    // Gambar border tipis antar segment
    offscreenCtx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    offscreenCtx.lineWidth = 1;
    offscreenCtx.stroke();

    // Gambar teks nama peserta
    drawSegmentText(offscreenCtx, i, middleAngle, radius);
  }

  // Gambar lingkaran tengah
  drawCenterCircle(offscreenCtx, centerX, centerY);

  // Copy dari offscreen ke canvas utama
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(offscreenCanvas, 0, 0);
}

/**
 * Menggambar teks di dalam segment roda
 * @param {CanvasRenderingContext2D} ctx - Context canvas
 * @param {number} segmentIndex - Index segment
 * @param {number} middleAngle - Sudut tengah segment
 * @param {number} radius - Radius roda
 */
function drawSegmentText(ctx, segmentIndex, middleAngle, radius) {
  const { centerX, centerY } = wheelCache;
  const text = availableEntries[segmentIndex];

  // Hitung posisi teks (lebih dekat ke tengah)
  const textRadius = radius - 70;
  const textX = centerX + textRadius * Math.cos(middleAngle);
  const textY = centerY + textRadius * Math.sin(middleAngle);

  // Tentukan ukuran font berdasarkan jumlah peserta
  let fontSize;
  if (availableEntries.length <= 50) {
    fontSize = 20;
  } else if (availableEntries.length <= 100) {
    fontSize = 16;
  } else if (availableEntries.length <= 200) {
    fontSize = 14;
  } else if (availableEntries.length <= 300) {
    fontSize = 12;
  } else {
    fontSize = 10;
  }

  // Simpan state canvas sebelum transformasi
  ctx.save();
  ctx.translate(textX, textY);

  // Putar teks agar selalu terbaca (horizontal)
  const angleDeg = ((middleAngle * 180) / Math.PI) % 360;
  if (angleDeg > 90 && angleDeg < 270) {
    // Jika teks terbalik, putar 180 derajat
    ctx.rotate(middleAngle + Math.PI);
  } else {
    ctx.rotate(middleAngle);
  }

  // Atur properti teks
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  // Potong teks jika terlalu panjang
  let displayText = text;
  const maxLength = availableEntries.length > 200 ? 8 : 12;
  if (displayText.length > maxLength) {
    displayText = displayText.substring(0, maxLength - 2) + "...";
  }

  // Gambar teks
  ctx.fillText(displayText, 0, 0);

  // Restore state canvas
  ctx.restore();
}

/**
 * Menggambar lingkaran tengah roda
 * @param {CanvasRenderingContext2D} ctx - Context canvas
 * @param {number} centerX - Posisi X tengah
 * @param {number} centerY - Posisi Y tengah
 */
function drawCenterCircle(ctx, centerX, centerY) {
  ctx.beginPath();
  ctx.arc(centerX, centerY, 30, 0, 2 * Math.PI);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  ctx.strokeStyle = "#333333";
  ctx.lineWidth = 3;
  ctx.stroke();
}

/**
 * Versi ultra-fast untuk 500+ peserta
 * Mengurangi detail untuk meningkatkan performa
 * @param {number} rotation - Rotasi dalam radian
 */
function drawWheelUltraFast(rotation = 0) {
  const { centerX, centerY, radius } = wheelCache;

  // Clear hanya area roda (tidak seluruh canvas)
  ctx.clearRect(
    centerX - radius - 5,
    centerY - radius - 5,
    radius * 2 + 10,
    radius * 2 + 10
  );

  const sliceAngle = (2 * Math.PI) / availableEntries.length;
  const fontSize = 9; // Font sangat kecil untuk banyak peserta

  // Gambar segments dengan optimasi (setiap 2-3 segment)
  for (let i = 0; i < availableEntries.length; i++) {
    const startAngle = i * sliceAngle + rotation;
    const endAngle = startAngle + sliceAngle;

    // Gambar segment
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();

    // Gambar teks hanya untuk setiap segment ke-3 (optimasi)
    if (i % 3 === 0) {
      const middleAngle = startAngle + sliceAngle / 2;
      const textRadius = radius - 65;
      const textX = centerX + textRadius * Math.cos(middleAngle);
      const textY = centerY + textRadius * Math.sin(middleAngle);
      const text = availableEntries[i];

      ctx.save();
      ctx.translate(textX, textY);

      // Putar teks agar terbaca
      const angleDeg = ((middleAngle * 180) / Math.PI) % 360;
      if (angleDeg > 90 && angleDeg < 270) {
        ctx.rotate(middleAngle + Math.PI);
      } else {
        ctx.rotate(middleAngle);
      }

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#FFFFFF";
      ctx.font = `bold ${fontSize}px Arial`;
      ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
      ctx.shadowBlur = 2;

      // Potong teks
      let displayText = text;
      if (displayText.length > 6) {
        displayText = displayText.substring(0, 4) + "..";
      }

      ctx.fillText(displayText, 0, 0);
      ctx.restore();
    }
  }

  // Gambar lingkaran tengah sederhana
  drawSimpleCenterCircle(ctx, centerX, centerY);
}

/**
 * Menggambar lingkaran tengah sederhana (versi fast)
 * @param {CanvasRenderingContext2D} ctx - Context canvas
 * @param {number} centerX - Posisi X tengah
 * @param {number} centerY - Posisi Y tengah
 */
function drawSimpleCenterCircle(ctx, centerX, centerY) {
  ctx.beginPath();
  ctx.arc(centerX, centerY, 20, 0, 2 * Math.PI);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
}

// ============================================
// FUNGSI SUARA RODA BERPUTAR
// ============================================

/**
 * Memutar suara roda berputar
 */
function playWheelSound() {
  if (!wheelSound) return;

  try {
    wheelSound.currentTime = 0; // Mulai dari awal
    wheelSound.loop = true; // Loop suara
    wheelSound.volume = 0.7; // Volume default
    wheelSound.play().catch((e) => {
      console.log("Tidak dapat memutar suara roda:", e);
    });
  } catch (error) {
    console.log("Error memutar suara:", error);
  }
}

/**
 * Menghentikan suara roda berputar
 */
function stopWheelSound() {
  if (!wheelSound) return;

  try {
    wheelSound.pause();
    wheelSound.currentTime = 0; // Reset ke awal
  } catch (error) {
    console.log("Error menghentikan suara:", error);
  }
}

/**
 * Fade out suara roda secara bertahap
 * Memberikan efek natural saat roda melambat
 */
function fadeOutWheelSound() {
  if (!wheelSound || !isDecelerating) return;

  const fadeInterval = setInterval(() => {
    if (wheelSound.volume > 0.1 && isDecelerating) {
      wheelSound.volume -= 0.05; // Kurangi volume bertahap
    } else {
      clearInterval(fadeInterval);
      if (wheelSound.volume <= 0.1) {
        stopWheelSound(); // Hentikan suara saat volume sangat kecil
      }
    }
  }, 100); // Update setiap 100ms
}

// ============================================
// FUNGSI ANIMASI RODA
// ============================================

/**
 * Memulai putaran roda berikutnya dalam sesi multiple spins
 */
function startNextSpin() {
  console.log(
    `startNextSpin dipanggil. Saat ini: ${currentSpinCount}, Total: ${totalSpins}`
  );

  // Cek apakah sudah mencapai jumlah putaran maksimum atau tidak ada peserta lagi
  if (currentSpinCount >= totalSpins || availableEntries.length === 0) {
    console.log("⏸️ Menunggu user menutup modal...");
    return; // ❌ JANGAN finish dulu
  }


  currentSpinCount++; // Increment counter putaran
  console.log(`Memulai putaran ${currentSpinCount} dari ${totalSpins}`);

  updateSpinCounter(); // Update UI counter
  updateManualStatus("🔄 Roda sedang berputar... Tekan STOP untuk menghentikan", "#4caf50");

  // Reset state animasi
  isWheelSpinning = true;
  stopRequested = false;
  isDecelerating = false;
  currentRotation = 0;

  // Set kecepatan awal berdasarkan jumlah peserta (optimasi)
  if (availableEntries.length > 500) currentSpeed = 0.1; // Untuk banyak peserta
  else if (availableEntries.length > 300) currentSpeed = 0.15;
  else if (availableEntries.length > 100) currentSpeed = 0.25;
  else currentSpeed = 0.35; // Untuk sedikit peserta

  prepareWheelCache(); // Siapkan cache untuk performa
  startContinuousSpin(); // Mulai animasi
}

/**
 * Memulai animasi putaran roda kontinu
 */
function startContinuousSpin() {
  if (!isWheelSpinning || availableEntries.length === 0) return;

  // Batalkan animation frame sebelumnya jika ada
  if (animationId) cancelAnimationFrame(animationId);

  // Mulai putar suara roda
  playWheelSound();

  let lastTime = 0;
  const targetFPS = 60; // Target frame rate
  const frameTime = 1000 / targetFPS;

  // Pilih fungsi drawing berdasarkan jumlah peserta
  const useUltraFast = availableEntries.length > 500;
  const drawFunction = useUltraFast ? drawWheelUltraFast : drawWheel;

  /**
   * Fungsi animasi utama
   * @param {number} time - Timestamp dari requestAnimationFrame
   */
  function animate(time) {
    if (!isWheelSpinning) return;

    // Frame limiting untuk smooth animation
    const delta = time - lastTime;
    if (delta < frameTime) {
      animationId = requestAnimationFrame(animate);
      return;
    }

    // Update rotasi berdasarkan kecepatan
    currentRotation += currentSpeed;
    drawFunction(currentRotation); // Gambar roda dengan rotasi baru

    lastTime = time;
    animationId = requestAnimationFrame(animate); // Request frame berikutnya
  }

  animationId = requestAnimationFrame(animate); // Mulai animasi
}
/**
 * Memulai proses perlambatan roda
 */
function startDeceleration() {
  if (!isWheelSpinning || isDecelerating) return;

  isDecelerating = true;

  // Mulai fade out suara roda
  fadeOutWheelSound();

  // Waktu tetap untuk deceleration: 3 detik
  const decelerationDuration = 3000; // 3000 ms = 3 detik
  let decelerationStartTime = null;
  
  // Simpan kecepatan awal saat mulai decelerate
  const initialSpeed = currentSpeed;

  // Pilih fungsi drawing
  const useUltraFast = availableEntries.length > 500;
  const drawFunction = useUltraFast ? drawWheelUltraFast : drawWheel;

  /**
   * Fungsi perlambatan roda dengan durasi tetap 3 detik
   * @param {number} time - Timestamp dari requestAnimationFrame
   */
  function decelerate(time) {
    if (!isWheelSpinning) return;

    // Set waktu mulai deceleration pada frame pertama
    if (decelerationStartTime === null) {
      decelerationStartTime = time;
    }

    // Hitung progress deceleration (0 sampai 1)
    const elapsed = time - decelerationStartTime;
    const progress = Math.min(elapsed / decelerationDuration, 1);

    // Gunakan easing function untuk smooth deceleration
    // currentSpeed berkurang dari nilai awal menjadi 0 dalam 3 detik
    currentSpeed = initialSpeed * (1 - progress);
    currentRotation += currentSpeed;
    drawFunction(currentRotation);

    // Cek apakah 3 detik sudah terlampaui
    if (progress >= 1) {
      currentSpeed = 0; // Set kecepatan ke 0
      isWheelSpinning = false;
      isDecelerating = false;

      // Pastikan suara berhenti
      stopWheelSound();

      // Bersihkan animation frame
      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }

      // Pilih pemenang berdasarkan rotasi akhir
      selectWinner(currentRotation);
      return;
    }

    // Lanjutkan perlambatan
    animationId = requestAnimationFrame(decelerate);
  }

  animationId = requestAnimationFrame(decelerate);
}

// ============================================
// FUNGSI UI (USER INTERFACE)
// ============================================

/**
 * Update counter putaran di UI
 */
function updateSpinCounter() {
  const counter = document.getElementById("spinCounter");
  if (totalSpins > 0) {
    counter.textContent = `Putaran ${currentSpinCount} dari ${totalSpins} (${availableEntries.length} peserta)`;
  } else {
    counter.textContent = ""; // Kosongkan jika tidak ada putaran
  }
}

/**
 * Enable/disable tombol-tombol di UI selama roda berputar
 * @param {boolean} disable - True untuk disable, false untuk enable
 */
function disableButtons(disable) {
  // Tombol hadiah cepat
  document.querySelectorAll(".winner-count-btn").forEach((btn) => {
    btn.disabled = disable;
  });
}

function updateManualStatus(message, color = "") {
  const manualStatus = document.getElementById("manualStatus");
  if (!manualStatus) return;
  manualStatus.textContent = message;
  if (color) manualStatus.style.color = color;
}

// ============================================
// PEMILIHAN PEMENANG
// ============================================

/**
 * Memilih pemenang berdasarkan rotasi akhir roda
 * @param {number} finalRotation - Rotasi akhir roda dalam radian
 */
async function selectWinner() {
  const winners = pickWinnersFair(selectedWinnerCount);
  allWinners = [...winners];
  savePendingWinnersBackup(winners);

  // Hapus pemenang dari peserta
  winners.forEach(winner => {
    const idx = availableEntries.indexOf(winner);
    if (idx !== -1) {
      availableEntries.splice(idx, 1);
    }
  });

  // Kirim ke server secara sequential untuk menghindari race condition
  console.log(`📤 Mengirim ${winners.length} pemenang ke server secara sequential...`);
  let lastResponse = null;
  for (const winner of winners) {
    const resultLabel = getResultLabel(winner);
    lastResponse = await addResultToServer(winner, false, resultLabel); // updateUI = false untuk menghindari flicker
  }

  // Update UI hanya sekali setelah semua pemenang dikirim
  if (lastResponse) {
    clearPendingWinnersBackup();
    updateResultsList(lastResponse.results);
    if (lastResponse.entries) {
      entries = lastResponse.entries;
      availableEntries = [...lastResponse.entries];
      updateEntriesList(lastResponse.entries);
    }
  } else {
    console.warn("Hasil belum tersimpan ke server. Pending backup browser tetap disimpan.");
    alert("Hasil sudah dipilih, tetapi belum berhasil disimpan ke backup server. Jangan tutup halaman jika memungkinkan; sistem akan mencoba memulihkan saat halaman dibuka lagi.");
  }

  // Tampilkan modal setelah data berhasil dikirim atau pending backup browser dibuat
  if (winners.length > 1) {
    showMultipleWinnersModal(winners);
  } else {
    showWinnerModal(winners[0]);
  }
  if (lastResponse) {
    console.log(`✅ Semua ${winners.length} pemenang berhasil dikirim ke server`);
  }

}

function closeWinnerManually() {
  console.log("🖱️ Modal ditutup manual oleh user");
  winnerModalOpen = false;
  closeModal();

  // Refresh roda
  if (availableEntries.length > 0) {
    prepareWheelCache();
    drawWheel(0);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  finishManualControl();
}

function closeModal() {
  const modal = document.getElementById("winnerModal");
  if (modal) {
    modal.classList.remove("show");
    console.log("✅ Modal ditutup");
  }
  
  // Hentikan win sound jika sedang dimainkan
  if (winSound) {
    winSound.pause();
    winSound.currentTime = 0;
  }
}


// ============================================
// MANAJEMEN MULTI-SPIN
// ============================================

/**
 * Memulai undian berdasarkan hadiah yang dipilih.
 * @param {string} prizeName - Nama hadiah
 * @param {number} count - Jumlah pemenang untuk hadiah tersebut
 */
function startPrizeSpin(prizeName, count) {
  selectedPrizeName = prizeName;
  startMultipleSpin(count, prizeName);
}

/**
 * Menyiapkan sesi undian berdasarkan hadiah.
 * @param {number} count - Jumlah pemenang yang akan dipilih
 * @param {string} prizeName - Nama hadiah yang sedang diundi
 */
function startMultipleSpin(count, prizeName = "") {
  console.log(`startMultipleSpin dipanggil dengan count: ${count}`);
  selectedPrizeName = prizeName || selectedPrizeName || "";

  // Validasi kondisi
  if (isSpinning) {
    console.log("Sudah dalam proses putaran, permintaan diabaikan");
    updateManualStatus("Sesi masih aktif. Tutup modal pemenang dulu sebelum memilih hadiah berikutnya.", "#ffc107");
    return;
  }
  if (availableEntries.length === 0) {
    selectedPrizeName = "";
    console.log("Tidak ada peserta tersedia");
    alert("Tidak ada peserta tersisa!");
    return;
  }

  // Hitung jumlah aktual (tidak boleh lebih dari peserta tersedia)
  const actualCount = Math.min(count, availableEntries.length);

  // Setup state untuk sesi baru. Total spin tetap 1 karena semua pemenang diambil dalam 1x spin.
  totalSpins = 1;
  currentSpinCount = 0;
  allWinners = [];
  selectedWinnerCount = actualCount;

  prepareWheelCache(); // Siapkan cache untuk performa

  console.log(`Menyiapkan undian ${actualCount} pemenang`);
  console.log(`Hadiah: ${selectedPrizeName || "-"}`);
  console.log(`Peserta tersedia: ${availableEntries.length}`);
  updateSpinCounter();
  updateManualStatus(`${selectedPrizeName} siap diundi (${actualCount} pemenang). Tekan START.`, "#4caf50");
}

// ============================================
// KOMUNIKASI DENGAN SERVER (PHP)
// ============================================

/**
 * Mengirim hasil pemenang ke server
 * @param {string} winner - Nama pemenang
 * @param {boolean} updateUI - Apakah harus update UI (default true)
 * @returns {Promise<Object>} - Response data dari server
 */
async function addResultToServer(winner, updateUI = false, resultLabel = "") {
  try {
    const formData = new FormData();
    formData.append("action", "add_result");
    formData.append("winner", winner);
    if (resultLabel) formData.append("result_label", resultLabel);

    // Kirim request ke server
    const response = await fetch("", {
      // Empty string = current page
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (data.success) {
      // Update UI hanya jika diminta (untuk menghindari flicker dengan multiple winners)
      if (updateUI) {
        updateResultsList(data.results);

        if (data.entries) {
          entries = data.entries;
          availableEntries = [...data.entries];
          updateEntriesList(data.entries);
        }
      }
      
      return data;
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

/**
 * Update daftar peserta di UI
 * @param {Array} entriesList - Daftar peserta baru
 */
function updateEntriesList(entriesList) {
  const entriesContainer = document.querySelector("#entries-tab .entry-list");
  const entriesBadge = document.getElementById("entriesBadge");
  const entriesStat = document.getElementById("entriesStat");

  if (!entriesContainer) return;

  // Virtual scrolling untuk performa (tampilkan maksimal 150)
  const maxVisible = 150;
  entriesContainer.innerHTML = "";

  // Tampilkan hanya bagian yang terlihat
  const visibleEntries = entriesList.slice(0, maxVisible);
  visibleEntries.forEach((entry, index) => {
    const div = document.createElement("div");
    div.className = "entry-item";
    div.innerHTML = `
      <span>${escapeHtml(entry)}</span>
      <form method="POST" style="display: inline;">
        <input type="hidden" name="action" value="remove_entry">
        <input type="hidden" name="index" value="${index}">
        <button type="submit" class="btn-remove">×</button>
      </form>
    `;
    entriesContainer.appendChild(div);
  });

  // Tambahkan info jika ada lebih banyak peserta
  if (entriesList.length > maxVisible) {
    const infoDiv = document.createElement("div");
    infoDiv.className = "entry-info";
    infoDiv.innerHTML = `<i>Menampilkan ${maxVisible} dari ${entriesList.length} peserta (gunakan Ctrl+F untuk mencari)</i>`;
    entriesContainer.appendChild(infoDiv);
  }

  // Update badge counter
  entriesBadge.textContent = entriesList.length;
  if (entriesStat) entriesStat.textContent = entriesList.length;

  // Persiapkan cache roda dengan data baru
  prepareWheelCache();
}

/**
 * Update daftar hasil pemenang di UI
 * @param {Array} results - Daftar pemenang
 */
function updateResultsList(results) {
  const resultsList = document.getElementById("resultsList");
  const resultsBadge = document.getElementById("resultsBadge");
  const resultsStat = document.getElementById("resultsStat");

  resultsList.innerHTML = "";

  // Buat elemen untuk setiap pemenang
  results.forEach((result, index) => {
    const div = document.createElement("div");
    div.className = "result-item";
    div.textContent = `🏆 ${index + 1}. ${result}`;
    resultsList.appendChild(div);
  });

  resultsBadge.textContent = results.length;
  if (resultsStat) resultsStat.textContent = results.length;
}

// ============================================
// FUNGSI MODAL PEMENANG
// ============================================

/**
 * Menampilkan modal pemenang
 * @param {string} winner - Nama pemenang
 */
/**
 * Fungsi untuk mengacak array menggunakan Fisher-Yates shuffle
 * Selalu gunakan Math.random() untuk hasil yang benar-benar acak
 * @param {Array} array - Array yang akan diacak
 * @returns {Array} - Array yang sudah diacak
 */
function shuffleArraySeeded(array) {
  const shuffled = [...array];

  for (let i = shuffled.length - 1; i > 0; i--) {
    // SELALU gunakan Math.random() untuk hasil truly random
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickWinnersFair(count) {
  if (availableEntries.length === 0) return [];
  
  const targetCount = Math.min(count, availableEntries.length);
  
  // Create a copy and use proper Fisher-Yates shuffle
  const shuffled = [...availableEntries];
  
  // Fisher-Yates shuffle - proven unbiased algorithm
  for (let i = shuffled.length - 1; i > 0; i--) {
    // Generate truly random index
    const j = Math.floor(Math.random() * (i + 1));
    // Swap
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  // Take first N from shuffled array
  const winners = shuffled.slice(0, targetCount);
  
  console.log(`✅ Pemenang terpilih secara adil: ${winners.join(", ")}`);
  return winners;
}


/**
 * Mengambil pemenang tambahan dengan pengacakan
 * Memilih peserta secara random dari daftar peserta tersedia
 * @param {number} count - Jumlah pemenang tambahan yang dibutuhkan
 * @returns {Array} - Array pemenang tambahan (sudah diacak)
 */
function getAdditionalWinners(count) {
  if (availableEntries.length === 0) return [];

  const entriesToChoose = Math.min(count, availableEntries.length);
  const selectedWinners = [];
  const availableIndices = Array.from({length: availableEntries.length}, (_, i) => i);

  // Pilih index secara acak tanpa pengulangan (truly random)
  for (let i = 0; i < entriesToChoose; i++) {
    const randomIdx = Math.floor(Math.random() * availableIndices.length);
    const entryIndex = availableIndices[randomIdx];
    selectedWinners.push(availableEntries[entryIndex]);
    availableIndices.splice(randomIdx, 1);
  }

  console.log(
    `📝 Pemenang tambahan: ${selectedWinners.join(", ")}`
  );

  return selectedWinners;
}

/**
 * Menampilkan modal dengan multiple winners
 * @param {Array} winners - Array nama pemenang
 */
function showMultipleWinnersModal(winners) {
  const modal = document.getElementById("winnerModal");
  const winnerName = document.getElementById("winnerName");
  const prizeTitle = selectedPrizeName
    ? `${escapeHtml(selectedPrizeName)} (${winners.length} pemenang)`
    : `Pemenang (${winners.length})`;

  console.log(`🎉 Menampilkan modal multiple pemenang: ${winners.join(", ")}`);
  
  winnerName.classList.add("multiple-winners");
  
  // Jika pemenang > 5, bagi menjadi 2 kolom
  if (winners.length > 5) {
    const midpoint = Math.ceil(winners.length / 2);
    const leftWinners = winners.slice(0, midpoint);
    const rightWinners = winners.slice(midpoint);
    
    // Format kolom kiri
    const leftHTML = leftWinners
      .map((winner, index) => `<div style="padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.1); color: #fff; font-size: 0.9em;">
        <strong style="color: #ffc107;">${index + 1}.</strong> ${escapeHtml(winner)}
      </div>`)
      .join("");
    
    // Format kolom kanan
    const rightHTML = rightWinners
      .map((winner, index) => `<div style="padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.1); color: #fff; font-size: 0.9em;">
        <strong style="color: #ffc107;">${midpoint + index + 1}.</strong> ${escapeHtml(winner)}
      </div>`)
      .join("");
    
    winnerName.innerHTML = `<div style="text-align: center;">
      <div class="winner-prize">📋 ${prizeTitle}</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 0.85em;">
        <div style="text-align: left;">
          ${leftHTML}
        </div>
        <div style="text-align: left;">
          ${rightHTML}
        </div>
      </div>
    </div>`;
  } else {
    // Single column untuk <= 5 pemenang
    const winnersHTML = winners
      .map((winner, index) => `<div style="padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.1); color: #fff; font-size: 0.9em;">
        <strong style="color: #ffc107;">${index + 1}.</strong> ${escapeHtml(winner)}
      </div>`)
      .join("");
    
    winnerName.innerHTML = `<div style="text-align: center;">
      <div class="winner-prize">📋 ${prizeTitle}</div>
      <div style="text-align: left; font-size: 0.85em;">
        ${winnersHTML}
      </div>
    </div>`;
  }
  
  modal.classList.add("show"); // Tampilkan modal
  
  // Delay kecil untuk memastikan modal muncul
  setTimeout(() => {
    console.log("🔊 Memutar suara kemenangan...");
    playWinSound(); // Mainkan suara kemenangan
  }, 300);
  
  createConfetti(); // Buat efek confetti
}


/**
 * Membuat efek confetti di sekitar modal
 */
function createConfetti() {
  const modal = document.querySelector(".modal-content");
  const colors = ["#ffc107", "#4caf50", "#2196F3", "#ef5350", "#9c27b0"];

  // Buat 25 confetti
  for (let i = 0; i < 25; i++) {
    const confetti = document.createElement("div");
    confetti.className = "confetti";

    // Random position dan properti
    confetti.style.left = Math.random() * 100 + "%";
    confetti.style.background =
      colors[Math.floor(Math.random() * colors.length)];
    confetti.style.animationDelay = Math.random() * 0.5 + "s";
    confetti.style.animationDuration = Math.random() * 2 + 2 + "s";

    modal.appendChild(confetti);

    // Hapus confetti setelah animasi selesai
    setTimeout(() => confetti.remove(), 3000);
  }
}

// ============================================
// TAB SWITCHING (Entries/Results)
// ============================================

/**
 * Switch antara tab Entries dan Results
 * @param {string} tab - Nama tab yang akan diaktifkan ('entries' atau 'results')
 */
function switchTab(tab) {
  // Hapus class active dari semua tab
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.remove("active"));
  document
    .querySelectorAll(".tab-content")
    .forEach((c) => c.classList.remove("active"));

  // Tambah class active ke tab yang diklik
  event.target.classList.add("active");
  document.getElementById(tab + "-tab").classList.add("active");
}

// ============================================
// EXCEL UPLOAD FUNCTIONS
// ============================================

/**
 * Handle upload file Excel
 * @param {Event} event - Event dari input file
 */
async function handleExcelUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Validasi tipe file
  const validTypes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
  ];
  const isValidType =
    validTypes.includes(file.type) || file.name.match(/\.(xlsx|xls)$/);

  if (!isValidType) {
    alert("File harus berformat Excel (.xlsx atau .xls)");
    event.target.value = ""; // Reset input
    return;
  }

  try {
    // Baca file Excel
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    // Ekstrak nama dari kolom A dan NIK dari kolom B
    const entries = jsonData
      .map((row) => {
        const name = row[0]; // Kolom A (Nama)
        const nik = row[1]; // Kolom B (NIK)
        
        // Validasi nama harus ada dan valid
        if (!name || typeof name !== "string" || name.trim() === "") {
          return null;
        }
        
        // Jika ada NIK, gabungkan dengan format: Nama (NIK)
        if (nik && String(nik).trim() !== "") {
          return `${String(name).trim()} (${String(nik).trim()})`;
        }
        
        // Jika tidak ada NIK, hanya tampilkan nama
        return String(name).trim();
      })
      .filter((entry) => entry !== null); // Filter yang null

    if (entries.length === 0) {
      alert("Tidak ada data nama yang valid di kolom A");
      event.target.value = "";
      return;
    }

    // Konfirmasi dengan user
    const confirmMsg = `Ditemukan ${entries.length} peserta.\n\nDengan jumlah ini, nama akan ditampilkan dengan font kecil di roda.\nLanjutkan?`;
    if (confirm(confirmMsg)) {
      await uploadEntriesToServer(entries);
    }

    event.target.value = ""; // Reset input
  } catch (error) {
    alert("Gagal membaca file: " + error.message);
    event.target.value = "";
  }
}

/**
 * Upload daftar peserta ke server
 * @param {Array} entriesList - Daftar peserta (nama atau nama + NIK)
 */
async function uploadEntriesToServer(entriesList) {
  try {
    const uploadBtn = document.querySelector(".btn-upload");
    uploadBtn.innerHTML = "⏳ Uploading...";
    uploadBtn.style.pointerEvents = "none"; // Nonaktifkan tombol selama upload

    // Siapkan form data
    const formData = new FormData();
    formData.append("action", "add_multiple_entries");

    // Tambahkan setiap peserta ke form data
    entriesList.forEach((entry, index) => {
      formData.append(`entries[${index}]`, entry);
    });

    // Kirim ke server
    const response = await fetch("", { method: "POST", body: formData });
    const data = JSON.parse(await response.text());

    if (data.success) {
      alert(`Berhasil menambahkan ${data.count} peserta! Total: ${data.total}`);

      // Update state lokal
      entries = [...entries, ...entriesList];
      availableEntries = [...entries];

      // Reload halaman untuk sinkronisasi dengan server
      window.location.reload();
    }
  } catch (error) {
    alert("Upload gagal: " + error.message);

    // Reset tombol upload
    const uploadBtn = document.querySelector(".btn-upload");
    uploadBtn.innerHTML = "📄 Upload Excel";
    uploadBtn.style.pointerEvents = "auto";
  }
}

// ============================================
// SKEMA 2: KONTROL MANUAL TOMBOL START/STOP
// ============================================

let manualControlActive = false; // Status apakah mode manual kontrol aktif
let manualWinnerCount = 0; // Jumlah pemenang untuk mode manual

/**
 * Fungsi untuk memulai spin dengan kontrol manual (tombol)
 * Minta user input jumlah pemenang terlebih dahulu
 */
function manualStartSpin() {
  console.log("manualStartSpin clicked", { manualControlActive, isWheelSpinning });
  const manualStatus = document.getElementById("manualStatus");

  // Jika tombol manual belum diminta input, minta sekarang
  if (!manualControlActive) {
    const count = selectedWinnerCount && selectedWinnerCount > 0 ? selectedWinnerCount : 0;

    if (!count || count < 1) {
      manualStatus.textContent = "❌ Pilih hadiah terlebih dahulu!";
      manualStatus.style.color = "#ff6b6b";
      return;
    }

    if (count > availableEntries.length) {
      manualStatus.textContent = `❌ Jumlah pemenang tidak boleh lebih dari ${availableEntries.length} peserta!`;
      manualStatus.style.color = "#ff6b6b";
      return;
    }

    // Set mode manual aktif
    manualControlActive = true;
    manualWinnerCount = count;
    selectedWinnerCount = count;
    totalSpins = 1;
    currentSpinCount = 0;
    allWinners = [];
    isSpinning = true;
    disableButtons(true);

    // Update UI
    manualStatus.textContent = "⏳ Roda sedang berputar... Tekan STOP untuk menghentikan";
    manualStatus.style.color = "#4caf50";
    document.getElementById("btn-manual-start").disabled = true;
    document.getElementById("btn-manual-stop").disabled = false;

    // Mulai spin
    startNextSpin();
  } else {
    console.log("manualStartSpin: manualControlActive already true, ignoring start request");
  }
}

/**
 * Fungsi untuk menghentikan spin dengan kontrol manual (tombol)
 */
function manualStopSpin() {
  if (!isWheelSpinning || isDecelerating) {
    console.log("Roda tidak sedang berputar atau sudah mulai melambat");
    return;
  }

  const manualStatus = document.getElementById("manualStatus");
  manualStatus.textContent = "⏹️ Menghentikan roda...";
  manualStatus.style.color = "#ffc107";

  // Request stop dan mulai deceleration
  stopRequested = true;
  startDeceleration();
}

/**
 * Fungsi untuk menyelesaikan mode manual kontrol
 */
function finishManualControl() {
  manualControlActive = false;
  manualWinnerCount = 0;
  isSpinning = false;
  isWheelSpinning = false;
  isDecelerating = false;
  stopRequested = false;
  totalSpins = 0;
  currentSpinCount = 0;
  selectedWinnerCount = 0;
  selectedPrizeName = "";

  const manualStatus = document.getElementById("manualStatus");

  // Reset UI
  document.getElementById("btn-manual-start").disabled = false;
  document.getElementById("btn-manual-stop").disabled = true;
  manualStatus.textContent = "✅ Selesai! Pilih hadiah berikutnya";
  manualStatus.style.color = "#4caf50";
  updateSpinCounter();
  disableButtons(false);
}

// ============================================
// INISIALISASI APLIKASI
// ============================================

// Inisialisasi sistem saat halaman dimuat
initializeWheelSound(); // Sistem audio
prepareWheelCache(); // Cache untuk roda

// Gambar roda awal
if (availableEntries.length > 500) {
  drawWheelUltraFast(0); // Versi ultra-fast untuk banyak peserta
} else {
  drawWheel(0); // Versi normal
}

recoverPendingWinnersBackup().catch((error) => {
  console.warn("Gagal memulihkan pending winner backup:", error);
});

// ============================================
// EVENT LISTENERS
// ============================================

// Event listener untuk upload Excel
document
  .getElementById("excelUpload")
  ?.addEventListener("change", handleExcelUpload);
