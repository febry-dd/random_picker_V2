<?php
session_start();

$defaultEntries = ['Hanna', 'Charles', 'Eric', 'Fatima', 'Gabriel'];
$backupDir = __DIR__ . DIRECTORY_SEPARATOR . 'data';
$backupFile = $backupDir . DIRECTORY_SEPARATOR . 'picker_backup.json';
$allPrizes = [
    ['name' => 'Sepeda Listrik', 'count' => 2],
    ['name' => 'TV', 'count' => 1],
    ['name' => 'Kulkas', 'count' => 1],
    ['name' => 'Mesin Cuci', 'count' => 1],
    ['name' => 'Dispenser', 'count' => 1],
    ['name' => 'Emoney', 'count' => 5],
    ['name' => 'Coffee Maker', 'count' => 1],
    ['name' => 'Pulpen Parker', 'count' => 4],
];

function normalizeList($items)
{
    if (!is_array($items)) {
        return [];
    }

    $clean = [];
    foreach ($items as $item) {
        $value = trim((string) $item);
        if ($value !== '') {
            $clean[] = $value;
        }
    }
    return $clean;
}

function loadPickerBackup($backupFile)
{
    if (!is_file($backupFile)) {
        return null;
    }

    $json = file_get_contents($backupFile);
    if ($json === false || trim($json) === '') {
        return null;
    }

    $data = json_decode($json, true);
    if (!is_array($data)) {
        return null;
    }

    return [
        'entries' => normalizeList($data['entries'] ?? []),
        'results' => normalizeList($data['results'] ?? []),
    ];
}

function savePickerBackup($backupDir, $backupFile, $entries, $results)
{
    if (!is_dir($backupDir)) {
        mkdir($backupDir, 0775, true);
    }

    $payload = [
        'updated_at' => date('c'),
        'entries' => array_values(normalizeList($entries)),
        'results' => array_values(normalizeList($results)),
    ];

    return file_put_contents(
        $backupFile,
        json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE),
        LOCK_EX
    ) !== false;
}

function resultHasPrize($results, $prizeName)
{
    $suffix = ' - ' . $prizeName;

    foreach ($results as $result) {
        $result = (string) $result;
        if (strpos($result, $suffix) !== false) {
            return true;
        }
    }

    return false;
}

function extractPrizeFromResult($result, $allPrizes)
{
    $prizeNames = array_column($allPrizes, 'name');
    usort($prizeNames, function ($a, $b) {
        return strlen($b) <=> strlen($a);
    });

    foreach ($prizeNames as $prizeName) {
        if (strpos((string) $result, ' - ' . $prizeName) !== false) {
            return $prizeName;
        }
    }

    return '';
}

function extractWinnerFromResult($result, $prizeName)
{
    $delimiter = ' - ' . $prizeName;
    $position = strpos((string) $result, $delimiter);

    if ($position === false) {
        return trim((string) $result);
    }

    return trim(substr((string) $result, 0, $position));
}

$backup = loadPickerBackup($backupFile);
if ($backup !== null) {
    $_SESSION['entries'] = $backup['entries'];
    $_SESSION['results'] = $backup['results'];
} else {
    $_SESSION['entries'] = normalizeList($_SESSION['entries'] ?? $defaultEntries);
    $_SESSION['results'] = normalizeList($_SESSION['results'] ?? []);
    savePickerBackup($backupDir, $backupFile, $_SESSION['entries'], $_SESSION['results']);
}

// Handle form submissions
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isset($_POST['action'])) {
        $stateChanged = false;
        switch ($_POST['action']) {
            case 'add_entry':
                if (!empty($_POST['entry'])) {
                    $_SESSION['entries'][] = trim($_POST['entry']);
                    $stateChanged = true;
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
                    savePickerBackup($backupDir, $backupFile, $_SESSION['entries'], $_SESSION['results']);
                    header('Content-Type: application/json');
                    echo json_encode([
                        'success' => true,
                        'count' => count($_POST['entries']),
                        'total' => count($_SESSION['entries']),
                        'backup' => true
                    ]);
                    exit;
                }
                break;
            case 'remove_entry':
                if (isset($_POST['index'])) {
                    array_splice($_SESSION['entries'], $_POST['index'], 1);
                    $stateChanged = true;
                }
                break;
            case 'clear_entries':
                $_SESSION['entries'] = [];
                $stateChanged = true;
                break;
            case 'clear_results':
                $_SESSION['results'] = [];
                $stateChanged = true;
                break;
            case 'add_result':
                if (!empty($_POST['winner'])) {
                    $resultLabel = !empty($_POST['result_label']) ? $_POST['result_label'] : $_POST['winner'];
                    if (!in_array($resultLabel, $_SESSION['results'], true)) {
                        $_SESSION['results'][] = $resultLabel;
                    }

                    // Remove winner from entries
                    $winnerToRemove = $_POST['winner'];
                    $key = array_search($winnerToRemove, $_SESSION['entries']);
                    if ($key !== false) {
                        array_splice($_SESSION['entries'], $key, 1);
                    }
                    $stateChanged = true;
                }
                savePickerBackup($backupDir, $backupFile, $_SESSION['entries'], $_SESSION['results']);
                header('Content-Type: application/json');
                echo json_encode([
                    'success' => true,
                    'results' => $_SESSION['results'],
                    'entries' => $_SESSION['entries'],
                    'backup' => true
                ]);
                exit;
            case 'redraw_winner':
                $index = isset($_POST['index']) ? (int) $_POST['index'] : -1;
                if ($index < 0 || !isset($_SESSION['results'][$index])) {
                    header('Content-Type: application/json');
                    echo json_encode([
                        'success' => false,
                        'message' => 'Data pemenang tidak ditemukan.'
                    ]);
                    exit;
                }

                if (count($_SESSION['entries']) === 0) {
                    header('Content-Type: application/json');
                    echo json_encode([
                        'success' => false,
                        'message' => 'Tidak ada peserta tersisa untuk undian pengganti.'
                    ]);
                    exit;
                }

                $oldResult = $_SESSION['results'][$index];
                if (strpos($oldResult, '[Tidak Hadir]') !== false) {
                    header('Content-Type: application/json');
                    echo json_encode([
                        'success' => false,
                        'message' => 'Pemenang ini sudah ditandai tidak hadir.'
                    ]);
                    exit;
                }

                $prizeName = extractPrizeFromResult($oldResult, $allPrizes);
                if ($prizeName === '') {
                    header('Content-Type: application/json');
                    echo json_encode([
                        'success' => false,
                        'message' => 'Hadiah untuk pemenang ini tidak bisa dibaca.'
                    ]);
                    exit;
                }

                $absentWinner = extractWinnerFromResult($oldResult, $prizeName);
                $replacementIndex = array_rand($_SESSION['entries']);
                $replacementWinner = $_SESSION['entries'][$replacementIndex];
                array_splice($_SESSION['entries'], $replacementIndex, 1);

                $_SESSION['results'][$index] = $oldResult . ' [Tidak Hadir]';
                $_SESSION['results'][] = $replacementWinner . ' - ' . $prizeName . ' [Pengganti ' . $absentWinner . ']';
                savePickerBackup($backupDir, $backupFile, $_SESSION['entries'], $_SESSION['results']);

                header('Content-Type: application/json');
                echo json_encode([
                    'success' => true,
                    'results' => $_SESSION['results'],
                    'entries' => $_SESSION['entries'],
                    'winner' => $replacementWinner,
                    'absent' => $absentWinner,
                    'prize' => $prizeName,
                    'backup' => true
                ]);
                exit;
        }
        if ($stateChanged) {
            savePickerBackup($backupDir, $backupFile, $_SESSION['entries'], $_SESSION['results']);
        }
    }
    header('Location: ' . $_SERVER['PHP_SELF']);
    exit;
}
$entries = $_SESSION['entries'];
$results = $_SESSION['results'];
$prizes = [];
foreach ($allPrizes as $prize) {
    if (!resultHasPrize($results, $prize['name'])) {
        $prizes[] = $prize;
    }
}
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
            <header class="app-header">
                <div class="eyebrow">Random Picker</div>
                <h1>SPIN WHEEL</h1>
                <p>Putar roda, pilih pemenang, dan kelola peserta dalam satu layar.</p>
            </header>

            <div class="stats-strip" aria-label="Ringkasan data">
                <div class="stat-pill">
                    <span class="stat-value" id="entriesStat"><?= count($entries) ?></span>
                    <span class="stat-label">Peserta</span>
                </div>
                <div class="stat-pill">
                    <span class="stat-value" id="resultsStat"><?= count($results) ?></span>
                    <span class="stat-label">Pemenang</span>
                </div>
            </div>

            <div class="wheel-container">
                <canvas id="wheel" width="600" height="600"></canvas>
                <div class="arrow"></div>
                <div class="center-circle"></div>
            </div>

            <div class="spin-counter" id="spinCounter"></div>

            <!-- SKEMA 2: Manual Control Buttons -->
                <div class="manual-control" id="manualControl">
                <h3>Kontrol Manual</h3>
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
            <div class="sidebar-header">
                <div>
                    <span class="eyebrow">Dashboard</span>
                    <h2>Daftar Undian</h2>
                </div>
            </div>

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
                        <span>📁</span> Upload Excel
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

                <h3 class="section-title">Pilih Hadiah</h3>

                <div class="quick-label">
                    daftar hadiah
                </div>

                <div class="winner-count-selector prize-selector">
                    <?php foreach ($prizes as $index => $prize): ?>
                        <button type="button" class="winner-count-btn prize-btn"
                            data-prize-name="<?= htmlspecialchars($prize['name']) ?>"
                            onclick="startPrizeSpin('<?= htmlspecialchars($prize['name'], ENT_QUOTES) ?>', <?= $prize['count'] ?>)"
                            id="btn-prize-<?= $index ?>">
                            <span class="prize-name"><?= htmlspecialchars($prize['name']) ?></span>
                            <span class="prize-count"><?= $prize['count'] ?> Pemenang</span>
                        </button>
                    <?php endforeach; ?>
                    <?php if (count($prizes) === 0): ?>
                        <div class="prize-empty">Semua hadiah sudah memiliki pemenang.</div>
                    <?php endif; ?>
                </div>

                <form method="POST">
                    <input type="hidden" name="action" value="clear_entries">
                    <button type="submit" class="btn btn-remove btn-block">
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
                    <button type="submit" class="btn btn-remove btn-block">
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

            <div class="modal-actions">
                <button class="close-modal" onclick="closeWinnerManually()">
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
        const prizeNames = <?= json_encode(array_column($allPrizes, 'name')) ?>;
    </script>
    <script src="xlsx.full.min.js"></script>
    <script src="app.js"></script>
</body>

</html>
