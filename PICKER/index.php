<?php
session_start();

// Initialize entries and results
if (!isset($_SESSION['entries'])) {
    $_SESSION['entries'] = ['Hanna', 'Charles', 'Eric', 'Fatima', 'Gabriel'];
}
if (!isset($_SESSION['results'])) {
    $_SESSION['results'] = [];
}

// Handle form submissions
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isset($_POST['action'])) {
        switch ($_POST['action']) {
            case 'add_entry':
                if (!empty($_POST['entry'])) {
                    $_SESSION['entries'][] = trim($_POST['entry']);
                }
                break;
            case 'add_multiple_entries':
                // Handle batch add from Excel
                if (!empty($_POST['entries']) && is_array($_POST['entries'])) {
                    foreach ($_POST['entries'] as $entry) {
                        if (!empty(trim($entry))) {
                            $_SESSION['entries'][] = trim($entry);
                        }
                    }
                    header('Content-Type: application/json');
                    echo json_encode([
                        'success' => true,
                        'count' => count($_POST['entries']),
                        'total' => count($_SESSION['entries'])
                    ]);
                    exit;
                }
                break;
            case 'remove_entry':
                if (isset($_POST['index'])) {
                    array_splice($_SESSION['entries'], $_POST['index'], 1);
                }
                break;
            case 'clear_entries':
                $_SESSION['entries'] = [];
                break;
            case 'clear_results':
                $_SESSION['results'] = [];
                break;
            case 'add_result':
                if (!empty($_POST['winner'])) {
                    $_SESSION['results'][] = $_POST['winner'];

                    // Remove winner from entries
                    $winnerToRemove = $_POST['winner'];
                    $key = array_search($winnerToRemove, $_SESSION['entries']);
                    if ($key !== false) {
                        array_splice($_SESSION['entries'], $key, 1);
                    }
                }
                header('Content-Type: application/json');
                echo json_encode([
                    'success' => true,
                    'results' => $_SESSION['results'],
                    'entries' => $_SESSION['entries']
                ]);
                exit;
        }
    }
    header('Location: ' . $_SERVER['PHP_SELF']);
    exit;
}

$entries = $_SESSION['entries'];
$results = $_SESSION['results'];
?>
<!DOCTYPE html>
<html lang="id">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SPIN WHEEL</title>
    <link rel="stylesheet" href="style.css">
</head>

<body>
    <div class="container">
        <div class="wheel-section">
            <h1 style="font-size: 36px; margin-bottom: 20px;">🎡 SPIN WHEEL</h1>

            <div class="wheel-container">
                <canvas id="wheel" width="600" height="600"></canvas>
                <div class="arrow"></div>
                <div class="center-circle"></div>
            </div>

            <div class="spin-counter" id="spinCounter"></div>

            <div class="voice-indicator" id="voiceIndicator">
                <div class="mic-icon">🎤</div>
                <div class="voice-status" id="voiceStatus">Siap Mendengar</div>
                <div class="voice-command" id="voiceCommand">Pilih jumlah pemenang, lalu ucapkan "START"</div>
            </div>

            <!-- SKEMA 2: Manual Control Buttons -->
                <div class="manual-control" id="manualControl">
                <h3 style="margin-top: 30px; margin-bottom: 15px;">🎮 Kontrol Manual</h3>
                <div class="manual-buttons">
                    <button type="button" class="btn btn-start" onclick="manualStartSpin()" id="btn-manual-start">
                        ▶️ START
                    </button>
                    <button type="button" class="btn btn-stop" onclick="manualStopSpin()" id="btn-manual-stop" disabled>
                        ⏹️ STOP
                    </button>
                </div>
                <div class="manual-status" id="manualStatus">Tekan START untuk mulai</div>
            </div>
        </div>

        <div class="sidebar">
            <div class="tabs">
                <button class="tab active" onclick="switchTab('entries')">
                    Entries <span class="badge" id="entriesBadge"><?= count($entries) ?></span>
                </button>
                <button class="tab" onclick="switchTab('results')">
                    Results <span class="badge" id="resultsBadge"><?= count($results) ?></span>
                </button>
            </div>

            <div id="entries-tab" class="tab-content active">
                <form method="POST" class="input-group">
                    <input type="hidden" name="action" value="add_entry">
                    <input type="text" name="entry" placeholder="Tambah peserta..." required>
                    <button type="submit" class="btn btn-secondary">Tambah</button>
                </form>

                <!-- Upload Excel Button -->
                <div class="upload-section">
                    <label for="excelUpload" class="btn btn-upload">
                        📁 Upload Excel
                        <input type="file" id="excelUpload" accept=".xlsx,.xls" style="display: none;">
                    </label>
                </div>

                <div class="entry-list">
                    <?php foreach ($entries as $index => $entry): ?>
                        <div class="entry-item">
                            <span><?= htmlspecialchars($entry) ?></span>
                            <form method="POST" style="display: inline;">
                                <input type="hidden" name="action" value="remove_entry">
                                <input type="hidden" name="index" value="<?= $index ?>">
                                <button type="submit" class="btn-remove">×</button>
                            </form>
                        </div>
                    <?php endforeach; ?>
                </div>

                <h3 style="margin: 20px 0 10px;">Pilih Jumlah Pemenang:</h3>

                <!-- Custom input for winner count -->
                <div class="custom-winner-input">
                    <input type="number" id="customWinnerCount" min="1" max="<?= count($entries) ?>"
                        placeholder="Masukkan jumlah..." class="winner-input">
                    <button type="button" class="btn btn-primary" onclick="startCustomSpin()" id="btn-custom">
                        Mulai
                    </button>
                </div>

                <div style="text-align: center; margin: 15px 0; color: rgba(255,255,255,0.5);">
                    atau pilih cepat:
                </div>

                <div class="winner-count-selector">
                    <?php foreach ([1, 2, 3, 5, 10, 20] as $count): ?>
                        <button type="button" class="winner-count-btn" onclick="startMultipleSpin(<?= $count ?>)"
                            id="btn-<?= $count ?>">
                            <?= $count ?> Pemenang
                        </button>
                    <?php endforeach; ?>
                </div>

                <form method="POST">
                    <input type="hidden" name="action" value="clear_entries">
                    <button type="submit" class="btn btn-remove" style="width: 100%; margin-top: 10px; padding: 12px;">
                        Hapus Semua Entries
                    </button>
                </form>
            </div>

            <div id="results-tab" class="tab-content">
                <div class="entry-list" id="resultsList">
                    <?php foreach ($results as $index => $result): ?>
                        <div class="result-item">
                            🏆 <?= ($index + 1) ?>. <?= htmlspecialchars($result) ?>
                        </div>
                    <?php endforeach; ?>
                </div>

                <form method="POST">
                    <input type="hidden" name="action" value="clear_results">
                    <button type="submit" class="btn btn-remove" style="width: 100%; margin-top: 10px; padding: 12px;">
                        Hapus Semua Results
                    </button>
                </form>
            </div>
        </div>
    </div>

    <div id="winnerModal" class="modal">
        <div class="modal-content">
            <h2>🎉 PEMENANG! 🎉</h2>

            <div class="winner-name" id="winnerName"></div>

            <div style="text-align:center; margin-top:20px;">
            <button
                class="close-modal"
                onclick="closeWinnerManually()"
                style="
                padding: 10px 25px;
                font-size: 16px;
                border-radius: 6px;
                cursor: pointer;
                "
            >
                ✅ Tutup
            </button>
            </div>
        </div>
        </div>

    <!-- Audio element untuk suara roda -->
    <audio id="wheelSound" preload="auto">
        <source src="sound/wheel.mp3" type="audio/mpeg">
        Browser Anda tidak mendukung elemen audio.
    </audio>

    <!-- Tambahkan setelah elemen audio wheelSound -->
    <audio id="winSound" preload="auto">
        <source src="sound/won.mp3" type="audio/mpeg">
        Browser Anda tidak mendukung elemen audio.
    </audio>

    <script>
        // Pass PHP data to JavaScript
        const initialEntries = <?= json_encode($entries) ?>;
        const initialResults = <?= json_encode($results) ?>;
    </script>
    <script src="xlsx.full.min.js"></script>
    <script src="app.js"></script>
</body>

</html>