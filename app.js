const FIREBASE_DB_URL = "https://teamscheduledrat-default-rtdb.asia-southeast1.firebasedatabase.app/"; 

// Cấu hình các ngày trong tuần và giờ làm việc (Từ 06:00 đến 00:00 tối)
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_LABELS = {
    'Monday': 'Thứ Hai',
    'Tuesday': 'Thứ Ba',
    'Wednesday': 'Thứ Tư',
    'Thursday': 'Thứ Năm',
    'Friday': 'Thứ Sáu',
    'Saturday': 'Thứ Bảy',
    'Sunday': 'Chủ Nhật'
};

const HOURS = [
    '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', 
    '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', 
    '20:00', '21:00', '22:00', '23:00'
];

// Bảng màu 60 sắc độ dựa trên palette Coolors (interpolated across 10 anchors)
// Anchors: dark -> light (sẽ được đảo ngược để PALETTE[0] = nhạt nhất, PALETTE[59] = đậm nhất)
const PALETTE_ANCHORS = [
    '#7400B8', '#8013BD', '#8B26C3', '#9739C8', '#A24CCD',
    '#AE60D3', '#B973D8', '#C586DD', '#D099E3', '#DCACE8'
];

function hexToRgb(hex) {
    const h = hex.replace('#','');
    const r = parseInt(h.substring(0,2), 16);
    const g = parseInt(h.substring(2,4), 16);
    const b = parseInt(h.substring(4,6), 16);
    return { r, g, b };
}

function rgbToHex(r, g, b) {
    const toHex = (v) => {
        const s = Math.round(Math.max(0, Math.min(255, v))).toString(16);
        return s.length === 1 ? '0' + s : s;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function interpolateHex(h1, h2, t) {
    const c1 = hexToRgb(h1);
    const c2 = hexToRgb(h2);
    const r = lerp(c1.r, c2.r, t);
    const g = lerp(c1.g, c2.g, t);
    const b = lerp(c1.b, c2.b, t);
    return rgbToHex(r, g, b);
}

function generatePalette(anchors, steps) {
    const result = [];
    if (!anchors || anchors.length === 0) return result;
    if (anchors.length === 1) {
        for (let i = 0; i < steps; i++) result.push(anchors[0]);
        return result;
    }
    const segments = anchors.length - 1;
    for (let i = 0; i < steps; i++) {
        const pos = (i / (steps - 1)) * segments;
        const idx = Math.floor(pos);
        const localT = pos - idx;
        const a = anchors[idx];
        const b = anchors[Math.min(idx + 1, anchors.length - 1)];
        result.push(interpolateHex(a, b, localT));
    }
    return result;
}

let PALETTE = generatePalette(PALETTE_ANCHORS, 60);
// Reverse so PALETTE[0] = lightest (background), PALETTE[59] = darkest
PALETTE = PALETTE.slice().reverse();

// Render palette legend gradient bars using exact PALETTE stops
function renderPaletteLegends() {
    const gradientStops = PALETTE.map((color, i) => {
        const pct = (i / (PALETTE.length - 1)) * 100;
        return `${color} ${pct.toFixed(1)}%`;
    }).join(', ');
    const gradient = `linear-gradient(to right, ${gradientStops})`;
    
    const bars = document.querySelectorAll('.palette-legend-bar');
    bars.forEach(bar => {
        bar.style.background = gradient;
    });
}

// Biến cho bộ chọn ngày của admin
let tempSelectedDates = [];
let calendarPickerCurrentDate = new Date();

function getRoomDays() {
    if (state.room && state.room.scheduleType === 'date' && state.room.selectedDates && state.room.selectedDates.length > 0) {
        return state.room.selectedDates;
    }
    return DAYS;
}

function getRoomDayLabel(day) {
    if (state.room && state.room.scheduleType === 'date') {
        const dateObj = new Date(day);
        const dayOfWeek = dateObj.getDay();
        const dayNames = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
        const formattedDate = dateObj.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
        return `${dayNames[dayOfWeek]} ${formattedDate}`;
    }
    return DAY_LABELS[day] || day;
}

// Trạng thái ứng dụng
let state = {
    currentRoomId: null,
    room: null,
    currentMemberId: null,
    isAdminUnlocked: false,
    adminFilters: {
        memberIds: [],    // [] = tất cả; [id1, id2] = lọc những id này
        days: [],         // [] = tất cả; ['Monday', ...] = lọc các ngày
        hours: [],        // [] = tất cả; ['08:00', ...] = lọc các giờ
        minFree: 0,       // minimum free people required for a slot to be considered
        minDuration: 1    // consecutive hours minimum to report as a block
    },
    selectedAdminCell: {
        day: null,
        hour: null
    },
    selectedAdminCells: [],
    isOfflineMode: true,
    showOtherMembersOnGrid: false,
    hasPendingSync: false,
    lastSuggestionsHash: ''
};

// Biến điều khiển thao tác kéo chuột tô lịch
let isDragging = false;
let dragMode = null; // 'free' hoặc 'busy'
let isAdminDragging = false;
let adminDragMode = null; // 'select' hoặc 'deselect'

// Khởi chạy khi trang tải xong
document.addEventListener('DOMContentLoaded', () => {
    checkFirebaseConfig();
    
    // Đọc mã phòng từ URL
    const urlParams = new URLSearchParams(window.location.search);
    state.currentRoomId = urlParams.get('room');
    
    if (state.currentRoomId) {
        // Có phòng: Ẩn Home, hiện App Workspace
        document.getElementById('home-view').classList.add('hidden');
        document.getElementById('app-workspace').classList.remove('hidden');
        
        initRoomView();
    } else {
        // Không có phòng: Hiện Trang chủ Home
        document.getElementById('home-view').classList.remove('hidden');
        document.getElementById('app-workspace').classList.add('hidden');
        
        initHomeView();
    }
    
    setupGlobalEventListeners();
    renderPaletteLegends();
});

// Kiểm tra cấu hình Firebase
function checkFirebaseConfig() {
    if (FIREBASE_DB_URL && FIREBASE_DB_URL.trim() !== "") {
        state.isOfflineMode = false;
        console.log("🔥 Hoạt động chế độ ONLINE (Firebase RTDB):", FIREBASE_DB_URL);
    } else {
        state.isOfflineMode = true;
        console.log("📂 Hoạt động chế độ OFFLINE (LocalStorage)");
    }
}

// -------------------------------------------------------------
// TRANG CHỦ (HOME VIEW) LOGIC
// -------------------------------------------------------------
function renderCalendarPicker() {
    const grid = document.getElementById('calendar-picker-days-grid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    const year = calendarPickerCurrentDate.getFullYear();
    const month = calendarPickerCurrentDate.getMonth(); // 0-indexed
    
    const monthNames = ['Tháng 01', 'Tháng 02', 'Tháng 03', 'Tháng 04', 'Tháng 05', 'Tháng 06', 'Tháng 07', 'Tháng 08', 'Tháng 09', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
    document.getElementById('calendar-picker-month-year').textContent = `${monthNames[month]}, ${year}`;
    
    let firstDayIndex = new Date(year, month, 1).getDay();
    // Monday as first column (index 0). Sunday (0) becomes 6, Monday (1) becomes 0, etc.
    let adjustedFirstDay = firstDayIndex === 0 ? 6 : firstDayIndex - 1;
    
    const totalDays = new Date(year, month + 1, 0).getDate();
    
    // Empty cells
    for (let i = 0; i < adjustedFirstDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-picker-day-cell empty-cell';
        grid.appendChild(emptyCell);
    }
    
    const today = new Date();
    for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
        const dayCell = document.createElement('div');
        dayCell.className = 'calendar-picker-day-cell';
        dayCell.textContent = dayNum;
        
        const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
        
        if (tempSelectedDates.includes(dateString)) {
            dayCell.classList.add('selected-date');
        }
        
        if (today.getFullYear() === year && today.getMonth() === month && today.getDate() === dayNum) {
            dayCell.classList.add('today-cell');
        }
        
        dayCell.addEventListener('click', () => {
            const idx = tempSelectedDates.indexOf(dateString);
            if (idx > -1) {
                tempSelectedDates.splice(idx, 1);
                dayCell.classList.remove('selected-date');
            } else {
                tempSelectedDates.push(dateString);
                dayCell.classList.add('selected-date');
            }
            tempSelectedDates.sort();
            document.getElementById('selected-dates-count').textContent = tempSelectedDates.length;
        });
        
        grid.appendChild(dayCell);
    }
}

function initHomeView() {
    renderRecentRooms();
    
    // Toggle schedule type selection
    const scheduleTypeRadios = document.getElementsByName('room-schedule-type');
    const dateSelectionContainer = document.getElementById('date-selection-container');
    
    scheduleTypeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'date') {
                dateSelectionContainer.classList.remove('hidden');
                renderCalendarPicker();
            } else {
                dateSelectionContainer.classList.add('hidden');
            }
        });
    });
    
    // Prev / Next month buttons
    document.getElementById('btn-prev-month').addEventListener('click', () => {
        calendarPickerCurrentDate.setMonth(calendarPickerCurrentDate.getMonth() - 1);
        renderCalendarPicker();
    });
    
    document.getElementById('btn-next-month').addEventListener('click', () => {
        calendarPickerCurrentDate.setMonth(calendarPickerCurrentDate.getMonth() + 1);
        renderCalendarPicker();
    });
    
    // Clear selection button
    document.getElementById('btn-clear-selected-dates').addEventListener('click', () => {
        tempSelectedDates = [];
        document.getElementById('selected-dates-count').textContent = '0';
        renderCalendarPicker();
    });
    
    // Đăng ký sự kiện Tạo phòng mới
    const formCreateRoom = document.getElementById('form-create-room');
    formCreateRoom.addEventListener('submit', async (e) => {
        e.preventDefault();
        const roomName = document.getElementById('room-name').value.trim();
        const adminPassword = document.getElementById('room-admin-password').value.trim();
        const scheduleType = document.querySelector('input[name="room-schedule-type"]:checked').value;
        
        if (!roomName || !adminPassword) return;
        
        if (scheduleType === 'date' && tempSelectedDates.length === 0) {
            showToast("Vui lòng chọn ít nhất một ngày để lập lịch!", "error");
            return;
        }
        
        const roomId = 'room_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        
        const newRoom = {
            id: roomId,
            name: roomName,
            adminPassword: adminPassword,
            scheduleType: scheduleType,
            selectedDates: scheduleType === 'date' ? tempSelectedDates : [],
            members: {}
        };
        
        await createRoomDatabase(newRoom);
    });
}

// Tạo phòng trong DB
async function createRoomDatabase(room) {
    try {
        if (state.isOfflineMode) {
            const rooms = getLocalRooms();
            rooms[room.id] = room;
            saveLocalRooms(rooms);
        } else {
            // Lưu lên Firebase
            const response = await fetch(`${FIREBASE_DB_URL}rooms/${room.id}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(room)
            });
            if (!response.ok) throw new Error("Ghi Firebase thất bại");
        }
        
        // Lưu vào danh sách truy cập gần đây (Recent Rooms) ở máy hiện tại
        saveRecentRoomToHistory(room.id, room.name);
        
        showToast("Tạo phòng lịch thành công!");
        
        // Chuyển hướng sang liên kết phòng
        window.location.href = `?room=${room.id}`;
        
    } catch (error) {
        console.error("Lỗi tạo phòng:", error);
        showToast("Không thể tạo phòng lúc này.", "error");
    }
}

// Lấy danh sách các phòng đã tham gia gần đây
function getRecentRoomsFromHistory() {
    const data = localStorage.getItem('teamsync_recent_rooms');
    return data ? JSON.parse(data) : {};
}

// Lưu phòng vào lịch sử
function saveRecentRoomToHistory(roomId, roomName) {
    const recent = getRecentRoomsFromHistory();
    recent[roomId] = {
        id: roomId,
        name: roomName,
        visitedAt: Date.now()
    };
    localStorage.setItem('teamsync_recent_rooms', JSON.stringify(recent));
}

// Xóa lịch sử phòng
function deleteRecentRoomFromHistory(roomId) {
    const recent = getRecentRoomsFromHistory();
    delete recent[roomId];
    localStorage.setItem('teamsync_recent_rooms', JSON.stringify(recent));
    renderRecentRooms();
}

// Hiển thị danh sách phòng đã tham gia gần đây trên Trang chủ
function renderRecentRooms() {
    const card = document.getElementById('recent-rooms-card');
    const list = document.getElementById('recent-rooms-list');
    const recent = Object.values(getRecentRoomsFromHistory()).sort((a,b) => b.visitedAt - a.visitedAt);
    
    if (recent.length === 0) {
        card.classList.add('hidden');
        return;
    }
    
    card.classList.remove('hidden');
    list.innerHTML = '';
    
    recent.forEach(room => {
        const li = document.createElement('li');
        li.className = 'recent-room-item';
        
        const dateStr = new Date(room.visitedAt).toLocaleDateString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: '2-digit'
        });
        
        li.innerHTML = `
            <a href="?room=${room.id}" class="recent-room-link">
                <span class="recent-room-name">${room.name}</span>
                <span class="recent-room-date">Đã truy cập: ${dateStr}</span>
            </a>
            <button type="button" class="btn-delete-recent" title="Xóa lịch sử phòng" data-id="${room.id}">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        `;
        
        // Đăng ký sự kiện nút xóa lịch sử
        li.querySelector('.btn-delete-recent').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            deleteRecentRoomFromHistory(room.id);
        });
        
        list.appendChild(li);
    });
}

// Helper lấy/lưu phòng offline LocalStorage
function getLocalRooms() {
    const data = localStorage.getItem('teamsync_rooms');
    return data ? JSON.parse(data) : {};
}

function saveLocalRooms(rooms) {
    localStorage.setItem('teamsync_rooms', JSON.stringify(rooms));
}

// -------------------------------------------------------------
// WORKSPACE PHÒNG (ROOM VIEW) LOGIC
// -------------------------------------------------------------
async function initRoomView() {
    buildMemberGrid();
    buildAdminGrid();
    populateAdminHoursList();
    populateFilterTimeDropdowns();
    
    // Tải dữ liệu phòng
    const success = await loadRoomData();
    if (!success) return; // Nếu phòng không tồn tại thì loadRoomData tự động redirect về Home
    
    // Đã lưu lịch sử truy cập phòng hiện tại
    saveRecentRoomToHistory(state.room.id, state.room.name);
    
    // Khôi phục mở khóa admin từ sessionStorage của phiên làm việc
    const isUnlocked = sessionStorage.getItem(`teamsync_unlocked_${state.currentRoomId}`) === 'true';
    if (isUnlocked) {
        unlockAdminView();
    }
    
    // Setup tự động đồng bộ thời gian thực mỗi 5 giây
    if (!state.isOfflineMode) {
        setInterval(async () => {
            await loadRoomData(true);
        }, 5000);
    }
}

// Tải dữ liệu phòng từ Database
async function loadRoomData(isBackground = false) {
    try {
        let roomData = null;
        if (state.isOfflineMode) {
            const rooms = getLocalRooms();
            roomData = rooms[state.currentRoomId];
        } else {
            // Tải dữ liệu từ Firebase
            const response = await fetch(`${FIREBASE_DB_URL}rooms/${state.currentRoomId}.json`);
            if (!response.ok) throw new Error("Kết nối Firebase thất bại");
            roomData = await response.json();
        }
        
        if (!roomData) {
            if (!isBackground) {
                showToast("Phòng đặt lịch không tồn tại!", "error");
                setTimeout(() => {
                    window.location.href = window.location.pathname; // Quay lại trang chủ
                }, 2000);
            }
            return false;
        }
        
        // Đảm bảo nút members luôn tồn tại là 1 đối tượng
        if (!roomData.members) {
            roomData.members = {};
        }
        
        state.room = roomData;
        
        if (!isBackground) {
            buildMemberGrid();
            buildAdminGrid();
            populateAdminDaysList();
            setupDayCheckboxEvents();
        }
        
        // Cập nhật tên phòng trên giao diện
        document.getElementById('workspace-room-name').textContent = state.room.name;
        
        // Cập nhật danh sách thành viên và các bộ lọc
        updateMemberDropdowns();
        updateMemberCounts();
        
        // Vẽ lại giao diện lưới lịch biểu của Admin
        renderAdminGrid();
        updateAdminDetails();
        updateSuggestions();
        renderHeatmapStats();
        
        // Vẽ lại lưới của Thành viên nếu có thành viên đang chọn
        if (state.currentMemberId && state.room.members[state.currentMemberId]) {
            fillMemberGridFromState(state.room.members[state.currentMemberId].schedule);
        } else if (state.showOtherMembersOnGrid) {
            // Nếu bật chế độ xem lịch nhóm nhưng chưa chọn ai cụ thể
            renderMemberGridDensity();
        }
        
        return true;
    } catch (error) {
        console.error("Lỗi tải phòng:", error);
        if (!isBackground) {
            showToast("Lỗi đồng bộ dữ liệu với Cloud.", "error");
        }
        return false;
    }
}

// Cập nhật số lượng người đã điền lịch
function updateMemberCounts() {
    const count = Object.keys(state.room.members).length;
    document.getElementById('member-count-value').textContent = count;
    document.getElementById('admin-total-members-count').textContent = count;
    
    const minFreeSlider = document.getElementById('admin-filter-min-free');
    if (minFreeSlider) {
        minFreeSlider.max = count;
    }
}

// Cập nhật danh sách thả xuống ở tab Thành viên + danh sách checkbox Admin
function updateMemberDropdowns() {
    const memberSelect = document.getElementById('member-select');
    const membersList = document.getElementById('admin-filter-members-list');
    
    const prevMemberVal = memberSelect.value;
    
    memberSelect.innerHTML = '<option value="" disabled selected>-- Chọn thành viên từ danh sách --</option>';
    
    // Clear old member checkboxes (keep only the "all" checkbox)
    const allCheckLabel = membersList.querySelector('.check-all-label');
    membersList.innerHTML = '';
    membersList.appendChild(allCheckLabel);
    
    const sortedMembers = Object.values(state.room.members).sort((a, b) => a.name.localeCompare(b.name));
    
    sortedMembers.forEach(member => {
        // Member tab dropdown
        const opt1 = document.createElement('option');
        opt1.value = member.id;
        opt1.textContent = member.name;
        memberSelect.appendChild(opt1);
        
        // Admin multi-checkbox
        const lbl = document.createElement('label');
        lbl.className = 'check-item-label';
        lbl.dataset.memberId = member.id;
        const isChecked = state.adminFilters.memberIds.length === 0 || state.adminFilters.memberIds.includes(member.id);
        lbl.innerHTML = `<input type="checkbox" class="admin-member-check" value="${member.id}" ${isChecked ? 'checked' : ''}><span>${member.name}</span>`;
        if (isChecked && state.adminFilters.memberIds.length > 0) lbl.classList.add('is-selected');
        membersList.appendChild(lbl);
    });
    
    if (prevMemberVal && state.room.members[prevMemberVal]) {
        memberSelect.value = prevMemberVal;
    }
    
    // Re-attach events for new member checkboxes
    setupAdminMemberCheckboxEvents();
}

// Thêm thành viên mới vào phòng
async function addNewMemberToRoom(name) {
    const cleanName = name.trim();
    if (!cleanName) return;
    
    // Kiểm tra tên trùng trong phòng
    const isDuplicate = Object.values(state.room.members).some(m => m.name.toLowerCase() === cleanName.toLowerCase());
    if (isDuplicate) {
        showToast("Tên thành viên này đã tồn tại trong phòng!", "error");
        return;
    }
    
    const memberId = 'm_' + Date.now();
    const newMember = {
        id: memberId,
        name: cleanName,
        schedule: createEmptySchedule()
    };
    
    state.room.members[memberId] = newMember;
    
    await saveRoomDataToDB();
    showToast(`Đã thêm thành viên: ${cleanName}`);
    
    await loadRoomData(true);
    selectMember(memberId);
}

// Lưu dữ liệu lịch cá nhân của thành viên
async function saveMemberScheduleToDB(memberId, schedule) {
    if (!state.room || !state.room.members[memberId]) return;
    
    state.room.members[memberId].schedule = schedule;
    
    await saveRoomDataToDB();
    showToast(`Đã lưu lịch biểu của ${state.room.members[memberId].name}`);
    
    await loadRoomData(true);
}

// Ghi dữ liệu phòng hiện tại xuống DB (Local hoặc Firebase)
async function saveRoomDataToDB() {
    try {
        if (state.isOfflineMode) {
            const rooms = getLocalRooms();
            rooms[state.currentRoomId] = state.room;
            saveLocalRooms(rooms);
        } else {
            // Firebase ghi đè toàn bộ dữ liệu phòng hiện tại
            await fetch(`${FIREBASE_DB_URL}rooms/${state.currentRoomId}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(state.room)
            });
        }
    } catch (error) {
        console.error("Lỗi ghi DB:", error);
        showToast("Lỗi đồng bộ Cloud (Chỉ lưu tạm thời)", "error");
    }
}

// -------------------------------------------------------------
// DENSITY HEATMAP LỊCH NHÓM CHO THÀNH VIÊN
// -------------------------------------------------------------
function renderMemberGridDensity() {
    if (!state.room) return;
    const cells = document.querySelectorAll('#member-schedule-grid .grid-slot-cell');
    const members = Object.values(state.room.members);
    const effectiveTotal = members.length;
    
    // If group view is OFF -> clear inline aggregation styles and leave `.state-free` CSS to show only current member
    if (!state.showOtherMembersOnGrid) {
        cells.forEach(cell => {
            cell.style.backgroundColor = '';
            cell.style.color = '';
            cell.style.boxShadow = '';
            cell.style.opacity = '';
        });
        return;
    }
    
    // Group view ON -> aggregate across members and apply palette (same logic as admin)
    cells.forEach(cell => {
        const day = cell.getAttribute('data-day');
        const hour = cell.getAttribute('data-hour');
        
        // Reset inline styles that might conflict
        cell.style.boxShadow = '';
        cell.style.opacity = '';
        
        // Count number of members free for this slot (including current user)
        let freeCount = 0;
        members.forEach(m => {
            if (m.schedule && m.schedule[day] && m.schedule[day].includes(hour)) {
                freeCount++;
            }
        });
        
        if (effectiveTotal > 0 && freeCount > 0) {
            let colorIndex = 0;
            if (effectiveTotal <= 60) {
                colorIndex = freeCount;
            } else {
                let step = Math.round(effectiveTotal / 60);
                if (step < 1) step = 1;
                colorIndex = Math.round(freeCount / step);
            }
            colorIndex = Math.min(59, Math.max(0, colorIndex));
            
            cell.style.backgroundColor = PALETTE[colorIndex];
            cell.style.color = colorIndex >= 25 ? '#f8fafc' : '#1a0a2e';
        } else {
            // no one free -> clear inline background so it looks neutral
            cell.style.backgroundColor = '';
            cell.style.color = '';
        }
    });
}

// -------------------------------------------------------------
// LƯỚI ĐIỀN LỊCH THÀNH VIÊN (MEMBER WORKSPACE)
// -------------------------------------------------------------
function buildMemberGrid() {
    const grid = document.getElementById('member-schedule-grid');
    grid.innerHTML = '';
    
    const firstCell = document.createElement('div');
    firstCell.className = 'grid-header-cell';
    firstCell.textContent = 'Thời Gian';
    grid.appendChild(firstCell);
    
    const daysList = getRoomDays();
    grid.style.setProperty('--grid-cols', daysList.length);
    
    daysList.forEach(day => {
        const headerCell = document.createElement('div');
        headerCell.className = 'grid-header-cell';
        headerCell.textContent = getRoomDayLabel(day);
        grid.appendChild(headerCell);
    });
    
    HOURS.forEach(hour => {
        const timeCell = document.createElement('div');
        timeCell.className = 'grid-time-cell';
        timeCell.textContent = `${hour} - ${getNextHourString(hour)}`;
        grid.appendChild(timeCell);
        
        daysList.forEach(day => {
            const slotCell = document.createElement('div');
            slotCell.className = 'grid-slot-cell';
            slotCell.setAttribute('data-day', day);
            slotCell.setAttribute('data-hour', hour);
            
            // Logic kéo thả chuột
            slotCell.addEventListener('mousedown', (e) => {
                if (state.currentMemberId === null) return;
                isDragging = true;
                
                if (slotCell.classList.contains('state-free')) {
                    dragMode = 'busy';
                    slotCell.classList.remove('state-free');
                } else {
                    dragMode = 'free';
                    slotCell.classList.add('state-free');
                }
                
                renderMemberGridDensity();
                e.preventDefault();
            });

            // Logic kéo thả trên di động
            slotCell.addEventListener('touchstart', (e) => {
                if (state.currentMemberId === null) return;
                isDragging = true;
                
                if (slotCell.classList.contains('state-free')) {
                    dragMode = 'busy';
                    slotCell.classList.remove('state-free');
                } else {
                    dragMode = 'free';
                    slotCell.classList.add('state-free');
                }
                
                renderMemberGridDensity();
                e.preventDefault();
            }, { passive: false });
            
            slotCell.addEventListener('mouseover', () => {
                if (!isDragging || state.currentMemberId === null) return;
                
                if (dragMode === 'free') {
                    slotCell.classList.add('state-free');
                } else {
                    slotCell.classList.remove('state-free');
                }
                renderMemberGridDensity();
            });
            
            grid.appendChild(slotCell);
        });
    });
}

// Điền lịch từ bộ nhớ lên lưới
function fillMemberGridFromState(schedule) {
    const cells = document.querySelectorAll('#member-schedule-grid .grid-slot-cell');
    cells.forEach(cell => {
        const day = cell.getAttribute('data-day');
        const hour = cell.getAttribute('data-hour');
        
        if (schedule[day] && schedule[day].includes(hour)) {
            cell.classList.add('state-free');
        } else {
            cell.classList.remove('state-free');
        }
    });
    
    renderMemberGridDensity();
}

// Thu thập các ô đang chọn rảnh trên lưới
function getScheduleFromMemberGrid() {
    const schedule = createEmptySchedule();
    const cells = document.querySelectorAll('#member-schedule-grid .grid-slot-cell');
    
    cells.forEach(cell => {
        if (cell.classList.contains('state-free')) {
            const day = cell.getAttribute('data-day');
            const hour = cell.getAttribute('data-hour');
            schedule[day].push(hour);
        }
    });
    
    return schedule;
}

// Chọn thành viên để điền
function selectMember(memberId) {
    if (!state.room || !state.room.members[memberId]) return;
    
    state.currentMemberId = memberId;
    document.getElementById('member-select').value = memberId;
    document.getElementById('current-member-name').textContent = state.room.members[memberId].name;
    document.getElementById('schedule-section').classList.remove('disabled-state');
    
    fillMemberGridFromState(state.room.members[memberId].schedule);
}

// -------------------------------------------------------------
// BẢNG QUẢN TRỊ (ADMIN DASHBOARD) LOGIC
// -------------------------------------------------------------
function buildAdminGrid() {
    const grid = document.getElementById('admin-schedule-grid');
    grid.innerHTML = '';
    
    const firstCell = document.createElement('div');
    firstCell.className = 'grid-header-cell';
    firstCell.textContent = 'Khung Giờ';
    grid.appendChild(firstCell);
    
    const daysList = getRoomDays();
    grid.style.setProperty('--grid-cols', daysList.length);
    
    daysList.forEach(day => {
        const headerCell = document.createElement('div');
        headerCell.className = 'grid-header-cell';
        headerCell.textContent = getRoomDayLabel(day);
        grid.appendChild(headerCell);
    });
    
    HOURS.forEach(hour => {
        const timeCell = document.createElement('div');
        timeCell.className = 'grid-time-cell';
        timeCell.textContent = `${hour} - ${getNextHourString(hour)}`;
        grid.appendChild(timeCell);
        
        daysList.forEach(day => {
            const slotCell = document.createElement('div');
            slotCell.className = 'grid-slot-cell admin-cell';
            slotCell.setAttribute('data-admin-day', day);
            slotCell.setAttribute('data-admin-hour', hour);
            
            slotCell.addEventListener('mousedown', (e) => {
                isAdminDragging = true;
                const isAlreadySelected = state.selectedAdminCells.some(c => c.day === day && c.hour === hour);
                if (isAlreadySelected) {
                    adminDragMode = 'deselect';
                    state.selectedAdminCells = state.selectedAdminCells.filter(c => !(c.day === day && c.hour === hour));
                } else {
                    adminDragMode = 'select';
                    state.selectedAdminCells.push({day, hour});
                }
                
                // Set single selected cell for detail popup reference if needed
                state.selectedAdminCell.day = day;
                state.selectedAdminCell.hour = hour;
                
                renderAdminGrid();
                updateAdminDetails();
                e.preventDefault();
            });

            slotCell.addEventListener('touchstart', (e) => {
                isAdminDragging = true;
                const isAlreadySelected = state.selectedAdminCells.some(c => c.day === day && c.hour === hour);
                if (isAlreadySelected) {
                    adminDragMode = 'deselect';
                    state.selectedAdminCells = state.selectedAdminCells.filter(c => !(c.day === day && c.hour === hour));
                } else {
                    adminDragMode = 'select';
                    state.selectedAdminCells.push({day, hour});
                }
                
                state.selectedAdminCell.day = day;
                state.selectedAdminCell.hour = hour;
                
                renderAdminGrid();
                updateAdminDetails();
                e.preventDefault();
            }, { passive: false });

            slotCell.addEventListener('mouseover', () => {
                if (!isAdminDragging) return;
                const isAlreadySelected = state.selectedAdminCells.some(c => c.day === day && c.hour === hour);
                if (adminDragMode === 'select' && !isAlreadySelected) {
                    state.selectedAdminCells.push({day, hour});
                    renderAdminGrid();
                    updateAdminDetails();
                } else if (adminDragMode === 'deselect' && isAlreadySelected) {
                    state.selectedAdminCells = state.selectedAdminCells.filter(c => !(c.day === day && c.hour === hour));
                    renderAdminGrid();
                    updateAdminDetails();
                }
            });

            slotCell.addEventListener('click', (e) => {
                // If the user just clicked without dragging, we show the popup
                showCellPopup(e, day, hour);
            });

            
            grid.appendChild(slotCell);
        });
    });
}

function renderAdminGrid() {
    if (!state.room) return;
    const cells = document.querySelectorAll('#admin-schedule-grid .admin-cell');
    
    // Xác định thành viên cần hiển thị
    const memberIds = state.adminFilters.memberIds;
    const membersToShow = memberIds.length > 0
        ? Object.values(state.room.members).filter(m => memberIds.includes(m.id))
        : Object.values(state.room.members);
    const effectiveTotal = membersToShow.length;
    
    // Xác định ngày và giờ cần hiển thị
    const filteredDays = state.adminFilters.days;
    const filteredHours = state.adminFilters.hours;
    
    cells.forEach(cell => {
        const day = cell.getAttribute('data-admin-day');
        const hour = cell.getAttribute('data-admin-hour');
        
        // Reset classes and inline styles
        cell.className = 'grid-slot-cell admin-cell';
        cell.style.backgroundColor = '';
        cell.style.color = '';
        
        if (state.selectedAdminCell.day === day && state.selectedAdminCell.hour === hour) {
            cell.classList.add('selected-cell');
        }
        
        if (state.selectedAdminCells && state.selectedAdminCells.some(c => c.day === day && c.hour === hour)) {
            cell.classList.add('selected-cell');
        }
        
        // Highlight filtered days/hours (make non-filtered ones faded)
        const isDayFiltered = filteredDays.length > 0 && !filteredDays.includes(day);
        const isHourFiltered = filteredHours.length > 0 && !filteredHours.includes(hour);
        
        if (isDayFiltered || isHourFiltered) {
            cell.style.opacity = '0.25';
        } else {
            cell.style.opacity = '';
        }

        
        // Tính số người rảnh trong nhóm được lọc
        let freeCount = 0;
        membersToShow.forEach(member => {
            if (member.schedule[day] && member.schedule[day].includes(hour)) {
                freeCount++;
            }
        });
        
        cell.textContent = freeCount > 0 ? freeCount : '';
        
        // Áp dụng màu sắc dựa trên 60 cấp độ của palette
        let colorIndex = 0;
        if (effectiveTotal > 0 && freeCount > 0) {
            if (effectiveTotal <= 60) {
                colorIndex = freeCount;
            } else {
                let step = Math.round(effectiveTotal / 60);
                if (step < 1) step = 1;
                colorIndex = Math.round(freeCount / step);
            }
            colorIndex = Math.min(59, Math.max(0, colorIndex));
        }
        
        cell.style.backgroundColor = PALETTE[colorIndex];
        cell.style.color = colorIndex >= 25 ? '#f8fafc' : '#1a0a2e';
    });
}

function updateAdminDetails() {
    const detailsContent = document.getElementById('admin-details-content');
    if (!detailsContent) return;
    
    if (!state.room || !state.room.members || Object.keys(state.room.members).length === 0) {
        detailsContent.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-users-slash"></i>
                <p>Chưa có thành viên nào điền lịch. Hãy gửi link cho mọi người tham gia điền lịch trước.</p>
            </div>
        `;
        return;
    }
    
    const memberIds = state.adminFilters.memberIds;
    const filteredDays = state.adminFilters.days;
    const filteredHours = state.adminFilters.hours;
    const minFree = state.adminFilters.minFree || 0;
    const minDuration = state.adminFilters.minDuration || 1;
    
    const membersToConsider = memberIds.length > 0
        ? Object.values(state.room.members).filter(m => memberIds.includes(m.id))
        : Object.values(state.room.members);

    if (membersToConsider.length === 0) {
        detailsContent.innerHTML = `<div class="empty-state"><p>Không có thành viên nào thỏa mãn bộ lọc.</p></div>`;
        return;
    }

    const activeDays = filteredDays.length > 0 ? filteredDays : getRoomDays();
    const activeHours = filteredHours.length > 0 ? filteredHours : HOURS;
    
    // Show filter results based on applied filters
    let html = `<h4><i class="fa-solid fa-filter"></i> Kết quả lọc</h4>`;
    
    // Show filter summary
    html += `<div class="filter-summary">`;
    html += `<div class="filter-summary-item">Thành viên: <strong>${membersToConsider.length}</strong></div>`;
    html += `<div class="filter-summary-item">Ngày: <strong>${activeDays.length}</strong></div>`;
    html += `<div class="filter-summary-item">Giờ: <strong>${activeHours.length}</strong></div>`;
    html += `<div class="filter-summary-item">Tối thiểu rảnh: <strong>${minFree} người</strong></div>`;
    html += `<div class="filter-summary-item">Thời lượng: <strong>${minDuration}h liên tiếp</strong></div>`;
    html += `</div>`;
    
    // Calculate and show filtered results
    let filteredSlots = [];
    
    if (minDuration > 1) {
        // Find consecutive blocks
        const blocks = findConsecutiveBlocks(membersToConsider, activeDays, activeHours, minDuration, minFree);
        blocks.sort((a, b) => b.freeCount - a.freeCount);
        filteredSlots = blocks.slice(0, 20);
    } else {
        // Find individual slots
        activeDays.forEach(day => {
            activeHours.forEach(hour => {
                const freeMembers = membersToConsider.filter(m => m.schedule[day] && m.schedule[day].includes(hour));
                if (freeMembers.length >= minFree) {
                    filteredSlots.push({
                        day,
                        hour,
                        freeCount: freeMembers.length,
                        freeNames: freeMembers.map(m => m.name),
                        total: membersToConsider.length
                    });
                }
            });
        });
        filteredSlots.sort((a, b) => b.freeCount - a.freeCount);
        filteredSlots = filteredSlots.slice(0, 20);
    }
    
    if (filteredSlots.length === 0) {
        html += `<div class="empty-state"><p>Không tìm thấy kết quả nào phù hợp bộ lọc.</p></div>`;
    } else {
        html += `<div class="detail-stat"><span class="number">${filteredSlots.length}</span><span class="total">kết quả tìm thấy</span></div>`;
        html += `<ul class="member-list">`;
        
        filteredSlots.forEach((slot, index) => {
            const pct = Math.round((slot.freeCount / membersToConsider.length) * 100);
            const tier = pct >= 100 ? 'gold' : pct >= 70 ? 'green' : 'blue';
            
            if (slot.duration) {
                // Block result
                html += `
                    <li class="member-list-item free-member" style="flex-direction: column; align-items: flex-start; gap: 0.4rem; padding: 0.8rem 1rem; border-left: 3px solid var(--color-success);">
                        <div style="display: flex; width: 100%; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                            <strong style="color: var(--text-primary);">#${index + 1}. ${getRoomDayLabel(slot.day)} · ${slot.startHour}–${slot.endHour}</strong>
                            <div style="display: flex; align-items: center; gap: 0.4rem;">
                                <span class="block-duration-tag">${slot.duration}h liên tiếp</span>
                                <span class="suggestion-tier-badge tier-badge-${tier}">${pct}% (${slot.freeCount}/${membersToConsider.length} người)</span>
                            </div>
                        </div>
                        <div style="font-size: 0.85rem; color: var(--text-secondary);">
                            <strong>Người rảnh:</strong> ${slot.freeNames.join(', ')}
                        </div>
                    </li>
                `;
            } else {
                // Single slot result
                html += `
                    <li class="member-list-item free-member" style="flex-direction: column; align-items: flex-start; gap: 0.4rem; padding: 0.8rem 1rem; border-left: 3px solid var(--color-success);">
                        <div style="display: flex; width: 100%; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                            <strong style="color: var(--text-primary);">#${index + 1}. ${getRoomDayLabel(slot.day)} · ${slot.hour}–${getNextHourString(slot.hour)}</strong>
                            <span class="suggestion-tier-badge tier-badge-${tier}">${pct}% (${slot.freeCount}/${slot.total} người)</span>
                        </div>
                        <div style="font-size: 0.85rem; color: var(--text-secondary);">
                            <strong>Người rảnh:</strong> ${slot.freeNames.join(', ')}
                        </div>
                    </li>
                `;
            }
        });
        
        html += `</ul>`;
    }
    
    detailsContent.innerHTML = html;
}

function updateSuggestions() {
    const suggestionsContent = document.getElementById('admin-suggestions-content');
    if (!suggestionsContent) return;
    
    if (!state.room || !state.room.members || Object.keys(state.room.members).length === 0) {
        suggestionsContent.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-users-slash"></i>
                <p>Chưa có thành viên nào điền lịch.</p>
            </div>
        `;
        return;
    }
    
    // Fixed suggestions: use all members, all days, all hours (no filters)
    const membersToConsider = Object.values(state.room.members);
    const activeDays = getRoomDays();
    const activeHours = HOURS;
    const minDur = 1;
    const minFree = 0;

    let topBlocks = [];
    let topSlots = [];

    if (minDur > 1) {
        const blocks = findConsecutiveBlocks(membersToConsider, activeDays, activeHours, minDur, minFree);
        blocks.sort((a, b) => b.freeCount - a.freeCount);
        topBlocks = blocks.slice(0, 10);
    } else {
        const allSlots = [];
        activeDays.forEach(day => {
            activeHours.forEach(hour => {
                const freeMembers = membersToConsider.filter(m => m.schedule[day] && m.schedule[day].includes(hour));
                if (freeMembers.length >= minFree) {
                    allSlots.push({ 
                        day, 
                        hour, 
                        freeCount: freeMembers.length, 
                        freeNames: freeMembers.map(m => m.name), 
                        total: membersToConsider.length 
                    });
                }
            });
        });
        allSlots.sort((a, b) => b.freeCount - a.freeCount);
        topSlots = allSlots.slice(0, 10);
    }

    if (topBlocks.length === 0 && topSlots.length === 0) {
        suggestionsContent.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-hourglass-empty"></i>
                <p>Không tìm thấy khung giờ rảnh nào.</p>
            </div>
        `;
        return;
    }

    let html = `<ul class="suggestion-list">`;
    
    if (topBlocks.length > 0) {
        topBlocks.forEach((block, index) => {
            const pct = Math.round((block.freeCount / membersToConsider.length) * 100);
            const tier = pct >= 100 ? 'gold' : pct >= 70 ? 'green' : 'blue';
            html += `
                <li class="member-list-item free-member" style="flex-direction: column; align-items: flex-start; gap: 0.4rem; padding: 0.8rem 1rem; border-left: 3px solid var(--color-success);">
                    <div style="display: flex; width: 100%; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                        <strong style="color: var(--text-primary);">#${index + 1}. ${getRoomDayLabel(block.day)} · ${block.startHour}–${block.endHour}</strong>
                        <div style="display: flex; align-items: center; gap: 0.4rem;">
                            <span class="block-duration-tag">${block.duration}h liên tiếp</span>
                            <span class="suggestion-tier-badge tier-badge-${tier}">${pct}% (${block.freeCount}/${membersToConsider.length} người)</span>
                        </div>
                    </div>
                    <div style="font-size: 0.85rem; color: var(--text-secondary);">
                        <strong>Người rảnh:</strong> ${block.freeNames.join(', ')}
                    </div>
                    <div class="suggestion-progress-wrap">
                        <div class="suggestion-progress-bar tier-${tier}" style="width: ${pct}%"></div>
                    </div>
                </li>
            `;
        });
    } else {
        topSlots.forEach((slot, index) => {
            const pct = Math.round((slot.freeCount / slot.total) * 100);
            const tier = pct >= 100 ? 'gold' : pct >= 70 ? 'green' : 'blue';
            html += `
                <li class="member-list-item free-member" style="flex-direction: column; align-items: flex-start; gap: 0.4rem; padding: 0.8rem 1rem; border-left: 3px solid var(--color-success);">
                    <div style="display: flex; width: 100%; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                        <strong style="color: var(--text-primary);">#${index + 1}. ${getRoomDayLabel(slot.day)} · ${slot.hour}–${getNextHourString(slot.hour)}</strong>
                        <span class="suggestion-tier-badge tier-badge-${tier}">${pct}% (${slot.freeCount}/${slot.total} người)</span>
                    </div>
                    <div style="font-size: 0.85rem; color: var(--text-secondary);">
                        <strong>Người rảnh:</strong> ${slot.freeNames.join(', ')}
                    </div>
                </li>
            `;
        });
    }
    
    html += `</ul>`;
    suggestionsContent.innerHTML = html;
}

// BẢNG QUẢN TRỊ (ADMIN DASHBOARD) HELPER FUNCTIONS
function unlockAdminView() {
    state.isAdminUnlocked = true;
    sessionStorage.setItem(`teamsync_unlocked_${state.currentRoomId}`, 'true');
    const lockCard = document.getElementById('admin-lock-card');
    const workspaceContent = document.getElementById('admin-workspace-content');
    if (lockCard) lockCard.classList.add('hidden');
    if (workspaceContent) workspaceContent.classList.remove('hidden');
    
    // Hiện nút lọc trên cùng bên phải khi admin mở khóa
    const filterBtn = document.getElementById('btn-open-filter-modal');
    if (filterBtn) filterBtn.classList.remove('hidden');
    
    renderAdminGrid();
    updateAdminDetails();
    updateSuggestions();
    renderHeatmapStats();
}

function populateFilterTimeDropdowns() {
    const startSelect = document.getElementById('filter-time-start');
    const endSelect = document.getElementById('filter-time-end');
    if (!startSelect || !endSelect) return;
    
    startSelect.innerHTML = '';
    endSelect.innerHTML = '';
    
    HOURS.forEach(hour => {
        const optStart = document.createElement('option');
        optStart.value = hour;
        optStart.textContent = hour;
        startSelect.appendChild(optStart);
        
        const nextHour = getNextHourString(hour);
        const optEnd = document.createElement('option');
        optEnd.value = nextHour;
        optEnd.textContent = nextHour;
        endSelect.appendChild(optEnd);
    });
    
    // Giá trị mặc định: từ giờ đầu tiên đến giờ kết thúc của slot cuối cùng
    startSelect.value = HOURS[0];
    endSelect.value = getNextHourString(HOURS[HOURS.length - 1]);
}

function selectDaysFilter(type) { // type: 'weekdays' hoặc 'weekends'
    const activeDays = getRoomDays();
    let selectedDays = [];
    
    if (state.room && state.room.scheduleType === 'date') {
        selectedDays = activeDays.filter(day => {
            const d = new Date(day).getDay();
            if (type === 'weekdays') return d >= 1 && d <= 5;
            if (type === 'weekends') return d === 0 || d === 6;
            return false;
        });
    } else {
        if (type === 'weekdays') {
            selectedDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        } else if (type === 'weekends') {
            selectedDays = ['Saturday', 'Sunday'];
        }
    }
    
    const dayAllCb = document.getElementById('admin-filter-day-all');
    if (dayAllCb) dayAllCb.checked = false;
    
    document.querySelectorAll('.admin-day-check').forEach(cb => {
        const val = cb.value;
        const shouldCheck = selectedDays.includes(val);
        cb.checked = shouldCheck;
        const label = cb.closest('.check-item-label');
        if (shouldCheck) {
            label?.classList.add('is-selected');
        } else {
            label?.classList.remove('is-selected');
        }
    });
    
    state.adminFilters.days = selectedDays;
    if (selectedDays.length === 0 && dayAllCb) {
        dayAllCb.checked = true;
    }
    
    renderAdminGrid();
    updateAdminDetails();
    updateSuggestions();
    renderHeatmapStats();
}

function applyTimeRangeFilter() {
    const startVal = document.getElementById('filter-time-start').value;
    const endVal = document.getElementById('filter-time-end').value;
    
    const toMinutes = (timeStr) => {
        const [h, m] = timeStr.split(':').map(Number);
        if (h === 0) return 24 * 60; // 00:00 ở cuối ngày
        return h * 60 + m;
    };
    
    const startMin = toMinutes(startVal);
    const endMin = toMinutes(endVal);
    
    const selectedHours = HOURS.filter(hour => {
        const hourMin = toMinutes(hour);
        return hourMin >= startMin && hourMin < endMin;
    });
    
    // Cập nhật checkboxes
    const hourAllCb = document.getElementById('admin-filter-hour-all');
    if (hourAllCb) hourAllCb.checked = false;
    
    document.querySelectorAll('.admin-hour-check').forEach(cb => {
        const val = cb.value;
        const shouldCheck = selectedHours.includes(val);
        cb.checked = shouldCheck;
        const label = cb.closest('.check-item-label');
        if (shouldCheck) {
            label?.classList.add('is-selected');
        } else {
            label?.classList.remove('is-selected');
        }
    });
    
    state.adminFilters.hours = selectedHours;
    if (selectedHours.length === 0 && hourAllCb) {
        hourAllCb.checked = true;
    }
    
    renderAdminGrid();
    updateAdminDetails();
    updateSuggestions();
    renderHeatmapStats();
}

function applyPreset(presetType) {
    const dayAllCb = document.getElementById('admin-filter-day-all');
    const hourAllCb = document.getElementById('admin-filter-hour-all');
    
    // Đặt lại các bộ lọc ngày
    if (dayAllCb) dayAllCb.checked = true;
    document.querySelectorAll('.admin-day-check').forEach(cb => {
        cb.checked = false;
        cb.closest('.check-item-label')?.classList.remove('is-selected');
    });
    state.adminFilters.days = [];
    
    // Đặt lại các bộ lọc giờ
    if (hourAllCb) hourAllCb.checked = true;
    document.querySelectorAll('.admin-hour-check').forEach(cb => {
        cb.checked = false;
        cb.closest('.check-item-label')?.classList.remove('is-selected');
    });
    state.adminFilters.hours = [];
    
    if (presetType === 'workhours') {
        // Ngày thường
        const activeDays = getRoomDays();
        let selectedDays = [];
        if (state.room && state.room.scheduleType === 'date') {
            selectedDays = activeDays.filter(day => {
                const d = new Date(day).getDay();
                return d >= 1 && d <= 5;
            });
        } else {
            selectedDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        }
        if (dayAllCb) dayAllCb.checked = false;
        document.querySelectorAll('.admin-day-check').forEach(cb => {
            const shouldCheck = selectedDays.includes(cb.value);
            cb.checked = shouldCheck;
            if (shouldCheck) cb.closest('.check-item-label')?.classList.add('is-selected');
        });
        state.adminFilters.days = selectedDays;
        
        // Giờ hành chính: 08:00 đến 17:00
        document.getElementById('filter-time-start').value = '08:00';
        document.getElementById('filter-time-end').value = '17:00';
        applyTimeRangeFilter();
        
    } else if (presetType === 'evening') {
        // Cả tuần
        if (dayAllCb) dayAllCb.checked = true;
        state.adminFilters.days = [];
        
        // Buổi tối: 18:00 đến 00:00
        document.getElementById('filter-time-start').value = '18:00';
        document.getElementById('filter-time-end').value = '00:00';
        applyTimeRangeFilter();
        
    } else if (presetType === 'weekend') {
        // Cuối tuần
        const activeDays = getRoomDays();
        let selectedDays = [];
        if (state.room && state.room.scheduleType === 'date') {
            selectedDays = activeDays.filter(day => {
                const d = new Date(day).getDay();
                return d === 0 || d === 6;
            });
        } else {
            selectedDays = ['Saturday', 'Sunday'];
        }
        if (dayAllCb) dayAllCb.checked = false;
        document.querySelectorAll('.admin-day-check').forEach(cb => {
            const shouldCheck = selectedDays.includes(cb.value);
            cb.checked = shouldCheck;
            if (shouldCheck) cb.closest('.check-item-label')?.classList.add('is-selected');
        });
        state.adminFilters.days = selectedDays;
        
        // Cả ngày
        if (hourAllCb) hourAllCb.checked = true;
        state.adminFilters.hours = [];
        
    } else if (presetType === 'morning') {
        // Cả tuần
        if (dayAllCb) dayAllCb.checked = true;
        state.adminFilters.days = [];
        
        // Sáng sớm: 06:00 đến 12:00
        document.getElementById('filter-time-start').value = '06:00';
        document.getElementById('filter-time-end').value = '12:00';
        applyTimeRangeFilter();
    }
    
    renderAdminGrid();
    updateAdminDetails();
}

// Attach delegated handlers for popup buttons
document.addEventListener('click', (e) => {
    const popup = document.getElementById('cell-info-popup');
    
    // Đóng popup nếu click ra ngoài
    if (popup && !popup.classList.contains('hidden')) {
        const isClickInside = popup.contains(e.target);
        const isCell = e.target.classList.contains('grid-slot-cell');
        const isCloseBtn = e.target.closest('.cell-popup-close');
        
        if (isCloseBtn || (!isClickInside && !isCell)) {
            popup.classList.add('hidden');
        }
    }
});

// Hàm hiển thị Popup khi click vào ô admin
function showCellPopup(e, day, hour) {
    const popup = document.getElementById('cell-info-popup');
    const title = document.getElementById('cell-popup-title');
    const body = document.getElementById('cell-popup-body');
    if (!popup || !title || !body) return;

    title.textContent = `${getRoomDayLabel(day)} · ${hour} - ${getNextHourString(hour)}`;
    
    const members = Object.values(state.room.members);
    const freeMembers = members.filter(m => m.schedule[day] && m.schedule[day].includes(hour));
    const busyMembers = members.filter(m => !m.schedule[day] || !m.schedule[day].includes(hour));

    let html = '';
    
    if (freeMembers.length > 0) {
        html += `<div class="popup-section">
                    <div class="popup-section-label">Rảnh (${freeMembers.length})</div>
                    <ul class="popup-member-list">`;
        freeMembers.forEach(m => {
            html += `<li class="popup-member-item free"><div class="popup-dot free"></div>${m.name}</li>`;
        });
        html += `</ul></div>`;
    } else {
        html += `<div class="popup-section"><div class="popup-section-label">Rảnh (0)</div></div>`;
    }

    if (busyMembers.length > 0) {
        if (freeMembers.length > 0) html += `<div class="cell-popup-divider"></div>`;
        html += `<div class="popup-section">
                    <div class="popup-section-label">Bận (${busyMembers.length})</div>
                    <ul class="popup-member-list">`;
        busyMembers.forEach(m => {
            html += `<li class="popup-member-item busy"><div class="popup-dot busy"></div>${m.name}</li>`;
        });
        html += `</ul></div>`;
    }

    body.innerHTML = html;

    // Vị trí hiển thị (hiển thị dưới/phải con trỏ chuột 15px)
    popup.classList.remove('hidden');
    
    let left = e.clientX + 15;
    let top = e.clientY + 15;
    
    // Chống tràn màn hình
    const rect = popup.getBoundingClientRect();
    if (left + rect.width > window.innerWidth) {
        left = e.clientX - rect.width - 15;
    }
    if (top + rect.height > window.innerHeight) {
        top = e.clientY - rect.height - 15;
    }
    
    // Đảm bảo không âm
    left = Math.max(10, left);
    top = Math.max(10, top);

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
}

// -------------------------------------------------------------
// EVENT LISTENERS & GENERAL ACTIONS
// -------------------------------------------------------------
function setupGlobalEventListeners() {
    // 1. Chuyển đổi tab
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            
            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            document.getElementById(tabId).classList.add('active');
            
            if (tabId === 'admin-tab') {
                const isUnlocked = sessionStorage.getItem(`teamsync_unlocked_${state.currentRoomId}`) === 'true';
                if (isUnlocked || state.isAdminUnlocked) {
                    unlockAdminView();
                } else {
                    document.getElementById('admin-lock-card').classList.remove('hidden');
                    document.getElementById('admin-workspace-content').classList.add('hidden');
                }
            }
        });
    });
    
    // 2. Quay lại trang chủ
    const btnGoHome = document.getElementById('btn-go-home');
    if (btnGoHome) {
        btnGoHome.addEventListener('click', () => {
            window.location.href = window.location.pathname; // Trở lại trang chủ, bỏ URL params
        });
    }
    
    // 3. Nút Sao chép liên kết chia sẻ phòng
    const btnShare = document.getElementById('btn-share-link');
    if (btnShare) {
        btnShare.addEventListener('click', () => {
            navigator.clipboard.writeText(window.location.href).then(() => {
                showToast("Đã sao chép link phòng! Hãy gửi link này cho mọi người tham gia.");
            }).catch(err => {
                console.error("Lỗi copy link:", err);
                showToast("Không thể tự động sao chép. Bạn hãy copy URL trình duyệt nhé.", "error");
            });
        });
    }
    
    // 4. Tab Thành viên: Thêm thành viên
    const btnAddMember = document.getElementById('btn-add-member');
    const inputNewMember = document.getElementById('new-member-name');
    
    if (btnAddMember && inputNewMember) {
        const handleAdd = async () => {
            const name = inputNewMember.value;
            if (!name.trim()) {
                showToast("Hãy nhập tên của bạn!", "error");
                return;
            }
            await addNewMemberToRoom(name);
            inputNewMember.value = '';
        };
        
        btnAddMember.addEventListener('click', handleAdd);
        inputNewMember.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleAdd();
        });
    }
    
    // 5. Tab Thành viên: Chọn thành viên từ select
    const memberSelect = document.getElementById('member-select');
    if (memberSelect) {
        memberSelect.addEventListener('change', (e) => {
            selectMember(e.target.value);
        });
    }
    
    // 6. Tab Thành viên: Lưu lịch biểu cá nhân
    const btnSaveSchedule = document.getElementById('btn-save-schedule');
    if (btnSaveSchedule) {
        btnSaveSchedule.addEventListener('click', async () => {
            if (!state.currentMemberId) {
                showToast("Hãy chọn tên của bạn ở Bước 1 trước khi lưu!", "error");
                return;
            }
            const schedule = getScheduleFromMemberGrid();
            await saveMemberScheduleToDB(state.currentMemberId, schedule);
        });
    }
    
    // 7. Tab Thành viên: Chọn nhanh / Xóa nhanh
    const btnSelectAll = document.getElementById('btn-select-all');
    const btnClearAll = document.getElementById('btn-clear-schedule');
    
    if (btnSelectAll) {
        btnSelectAll.addEventListener('click', () => {
            if (!state.currentMemberId) return;
            document.querySelectorAll('#member-schedule-grid .grid-slot-cell').forEach(cell => {
                cell.classList.add('state-free');
            });
            renderMemberGridDensity();
        });
    }
    if (btnClearAll) {
        btnClearAll.addEventListener('click', () => {
            if (!state.currentMemberId) return;
            document.querySelectorAll('#member-schedule-grid .grid-slot-cell').forEach(cell => {
                cell.classList.remove('state-free');
            });
            renderMemberGridDensity();
        });
    }
    
    // 8. Tab Thành viên: Checkbox bật tắt hiện lịch nhóm
    const checkboxShowOther = document.getElementById('checkbox-show-other-members');
    if (checkboxShowOther) {
        checkboxShowOther.addEventListener('change', (e) => {
            state.showOtherMembersOnGrid = e.target.checked;
            renderMemberGridDensity();
        });
    }
    
    // 9. Tab Admin: Xác thực mật khẩu
    const formAdminAuth = document.getElementById('form-admin-auth');
    if (formAdminAuth) {
        formAdminAuth.addEventListener('submit', (e) => {
            e.preventDefault();
            const passwordInput = document.getElementById('admin-auth-password').value;
            
            if (passwordInput === state.room.adminPassword) {
                unlockAdminView();
                document.getElementById('admin-auth-password').value = '';
                showToast("Đã mở khóa Bảng quản trị!");
            } else {
                showToast("Mật khẩu quản trị sai!", "error");
            }
        });
    }
    
    // 10. Tab Admin: Bộ lọc multi-select
    const btnResetFilters = document.getElementById('btn-reset-filters');
    
    // Setup member checkbox events (sẽ được gọi lại sau khi có thành viên)
    setupAdminMemberCheckboxEvents();
    
    // Day checkboxes
    setupDayCheckboxEvents();
    
    // Hour checkboxes
    setupHourCheckboxEvents();
    
    // 10. Tab Admin: Bộ lọc Modal & các điều khiển
    const adminFilterModal = document.getElementById('admin-filter-modal');
    const btnOpenFilterModal = document.getElementById('btn-open-filter-modal');
    const btnCloseFilterModal = document.getElementById('btn-close-filter-modal');
    const btnApplyFilters = document.getElementById('btn-apply-filters');
    
    if (btnOpenFilterModal && adminFilterModal) {
        btnOpenFilterModal.addEventListener('click', () => {
            adminFilterModal.classList.remove('hidden');
        });
    }
    
    const hideFilterModal = () => {
        if (adminFilterModal) adminFilterModal.classList.add('hidden');
    };
    
    if (btnCloseFilterModal) btnCloseFilterModal.addEventListener('click', hideFilterModal);
    if (btnApplyFilters) btnApplyFilters.addEventListener('click', hideFilterModal);
    if (adminFilterModal) {
        adminFilterModal.addEventListener('click', (e) => {
            if (e.target === adminFilterModal) hideFilterModal();
        });
    }

    // Các sự kiện cho Preset
    document.querySelectorAll('.btn-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.getAttribute('data-preset');
            applyPreset(preset);
        });
    });

    // Các nút chọn nhanh khung giờ
    const btnFilterMorning = document.getElementById('btn-filter-morning');
    const btnFilterAfternoon = document.getElementById('btn-filter-afternoon');
    const btnFilterEvening = document.getElementById('btn-filter-evening');
    
    if (btnFilterMorning) {
        btnFilterMorning.addEventListener('click', () => {
            document.getElementById('filter-time-start').value = '06:00';
            document.getElementById('filter-time-end').value = '12:00';
            applyTimeRangeFilter();
        });
    }
    if (btnFilterAfternoon) {
        btnFilterAfternoon.addEventListener('click', () => {
            document.getElementById('filter-time-start').value = '12:00';
            document.getElementById('filter-time-end').value = '18:00';
            applyTimeRangeFilter();
        });
    }
    if (btnFilterEvening) {
        btnFilterEvening.addEventListener('click', () => {
            document.getElementById('filter-time-start').value = '18:00';
            document.getElementById('filter-time-end').value = '00:00';
            applyTimeRangeFilter();
        });
    }

    // Sự kiện thay đổi của Dropdown lọc giờ
    const startSelect = document.getElementById('filter-time-start');
    const endSelect = document.getElementById('filter-time-end');
    if (startSelect) startSelect.addEventListener('change', applyTimeRangeFilter);
    if (endSelect) endSelect.addEventListener('change', applyTimeRangeFilter);

    // Các nút chọn nhanh ngày (Ngày thường / Cuối tuần)
    const btnFilterWeekdays = document.getElementById('btn-filter-weekdays');
    const btnFilterWeekends = document.getElementById('btn-filter-weekends');
    
    if (btnFilterWeekdays) {
        btnFilterWeekdays.addEventListener('click', () => {
            selectDaysFilter('weekdays');
        });
    }
    if (btnFilterWeekends) {
        btnFilterWeekends.addEventListener('click', () => {
            selectDaysFilter('weekends');
        });
    }

    // Thanh trượt lọc số người rảnh tối thiểu
    const minFreeSlider = document.getElementById('admin-filter-min-free');
    const minFreeVal = document.getElementById('admin-filter-min-free-val');
    if (minFreeSlider && minFreeVal) {
        minFreeSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            state.adminFilters.minFree = val;
            minFreeVal.textContent = val === 0 ? "Tất cả" : `${val} người`;
            renderAdminGrid();
            updateAdminDetails();
        });
    }

    // Các nút chọn thời lượng liên tiếp
    document.querySelectorAll('.btn-duration').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.btn-duration').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.adminFilters.minDuration = parseInt(btn.getAttribute('data-dur'));
            renderAdminGrid();
            updateAdminDetails();
        });
    });
    
    if (btnResetFilters) {
        btnResetFilters.addEventListener('click', () => {
            state.adminFilters.memberIds = [];
            state.adminFilters.days = [];
            state.adminFilters.hours = [];
            state.adminFilters.minFree = 0;
            state.adminFilters.minDuration = 1;
            state.selectedAdminCell.day = null;
            state.selectedAdminCell.hour = null;
            
            // Reset member checkboxes
            const memberAllCb = document.getElementById('admin-filter-member-all');
            if (memberAllCb) memberAllCb.checked = true;
            document.querySelectorAll('.admin-member-check').forEach(cb => {
                cb.checked = false;
                cb.closest('.check-item-label')?.classList.remove('is-selected');
            });
            
            // Reset day checkboxes
            const dayAllCb = document.getElementById('admin-filter-day-all');
            if (dayAllCb) dayAllCb.checked = true;
            document.querySelectorAll('.admin-day-check').forEach(cb => {
                cb.checked = false;
                cb.closest('.check-item-label')?.classList.remove('is-selected');
            });
            
            // Reset hour checkboxes
            const hourAllCb = document.getElementById('admin-filter-hour-all');
            if (hourAllCb) hourAllCb.checked = true;
            document.querySelectorAll('.admin-hour-check').forEach(cb => {
                cb.checked = false;
                cb.closest('.check-item-label')?.classList.remove('is-selected');
            });

            // Reset range slider
            const slider = document.getElementById('admin-filter-min-free');
            const valSpan = document.getElementById('admin-filter-min-free-val');
            if (slider) slider.value = 0;
            if (valSpan) valSpan.textContent = "Tất cả";

            // Reset duration buttons
            document.querySelectorAll('.btn-duration').forEach(btn => {
                if (btn.getAttribute('data-dur') === '1') {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });

            // Reset time select dropdowns
            const startDropdown = document.getElementById('filter-time-start');
            const endDropdown = document.getElementById('filter-time-end');
            if (startDropdown) startDropdown.value = HOURS[0];
            if (endDropdown) endDropdown.value = getNextHourString(HOURS[HOURS.length - 1]);
            
            document.querySelectorAll('#admin-schedule-grid .grid-slot-cell').forEach(c => {
                c.classList.remove('selected-cell');
                c.style.opacity = '';
            });
            
            renderAdminGrid();
            updateAdminDetails();
        });
    }
    
    // 11. Modal Setup Firebase
    const firebaseModal = document.getElementById('firebase-modal');
    const btnToggleSetup = document.getElementById('btn-toggle-setup');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnCloseModalFooter = document.getElementById('btn-close-modal-footer');
    
    if (firebaseModal && btnToggleSetup) {
        const showModal = (e) => {
            e.preventDefault();
            firebaseModal.classList.remove('hidden');
        };
        const hideModal = () => {
            firebaseModal.classList.add('hidden');
        };
        
        btnToggleSetup.addEventListener('click', showModal);
        btnCloseModal.addEventListener('click', hideModal);
        btnCloseModalFooter.addEventListener('click', hideModal);
        
        firebaseModal.addEventListener('click', (e) => {
            if (e.target === firebaseModal) hideModal();
        });
    }
    
    // Đóng kéo chuột chung
    window.addEventListener('mouseup', () => {
        isDragging = false;
        isAdminDragging = false;
        dragMode = null;
        adminDragMode = null;
    });

    // --- CẢM ỨNG (TOUCH EVENTS) ĐỂ KÉO THẢ TRÊN ĐIỆN THOẠI ---
    // Member grid touch dragging
    const handleMemberTouchMove = (e) => {
        if (!isDragging || state.currentMemberId === null) return;
        e.preventDefault(); // Ngăn cuộn trang khi đang kéo
        const touch = e.touches[0];
        const elem = document.elementFromPoint(touch.clientX, touch.clientY);
        if (elem) {
            const cell = elem.closest('.grid-slot-cell');
            if (cell && !cell.classList.contains('admin-cell')) {
                if (dragMode === 'free') {
                    cell.classList.add('state-free');
                } else {
                    cell.classList.remove('state-free');
                }
                renderMemberGridDensity();
            }
        }
    };

    // Admin grid touch dragging
    const handleAdminTouchMove = (e) => {
        if (!isAdminDragging) return;
        e.preventDefault(); // Ngăn cuộn trang
        const touch = e.touches[0];
        const elem = document.elementFromPoint(touch.clientX, touch.clientY);
        if (elem) {
            const cell = elem.closest('.admin-cell');
            if (cell) {
                const day = cell.getAttribute('data-admin-day');
                const hour = cell.getAttribute('data-admin-hour');
                if (!day || !hour) return;

                const isAlreadySelected = state.selectedAdminCells.some(c => c.day === day && c.hour === hour);
                if (adminDragMode === 'select' && !isAlreadySelected) {
                    state.selectedAdminCells.push({day, hour});
                    renderAdminGrid();
                    updateAdminDetails();
                } else if (adminDragMode === 'deselect' && isAlreadySelected) {
                    state.selectedAdminCells = state.selectedAdminCells.filter(c => !(c.day === day && c.hour === hour));
                    renderAdminGrid();
                    updateAdminDetails();
                }
            }
        }
    };

    window.addEventListener('touchmove', (e) => {
        if (isDragging) handleMemberTouchMove(e);
        if (isAdminDragging) handleAdminTouchMove(e);
    }, { passive: false });

    window.addEventListener('touchend', () => {
        isDragging = false;
        isAdminDragging = false;
        dragMode = null;
        adminDragMode = null;
    });

    // Thêm hỗ trợ phím Escape đóng popup admin
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const popup = document.getElementById('cell-info-popup');
            if (popup) popup.classList.add('hidden');
        }
    });

}

// -------------------------------------------------------------
// HELPERS
// -------------------------------------------------------------
function getNextHourString(hourStr) {
    const [h, m] = hourStr.split(':').map(Number);
    let nextH = h + 1;
    if (nextH === 24) nextH = 0;
    return `${String(nextH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function createEmptySchedule() {
    const schedule = {};
    const activeDays = getRoomDays();
    activeDays.forEach(day => {
        schedule[day] = [];
    });
    return schedule;
}

// Tìm các block liên tiếp (nối tiếp nhau) >= minDur giờ, trong đó có >= minPeople rảnh TẤT CẢ các giờ trong block (intersection)
function findConsecutiveBlocks(members, activeDays, activeHours, minDur, minPeople = 1) {
    const blocks = [];
    const hourIndices = activeHours.map(h => HOURS.indexOf(h)).sort((a,b) => a - b);
    
    activeDays.forEach(day => {
        for (let i = 0; i <= hourIndices.length - minDur; i++) {
            // Kiểm tra xem các giờ từ i đến i + minDur - 1 có liên tiếp nhau không
            let isConsecutive = true;
            for (let k = 0; k < minDur - 1; k++) {
                if (hourIndices[i + k + 1] !== hourIndices[i + k] + 1) {
                    isConsecutive = false;
                    break;
                }
            }
            if (!isConsecutive) continue;

            const blockHours = [];
            for (let k = 0; k < minDur; k++) {
                blockHours.push(HOURS[hourIndices[i + k]]);
            }

            // Tìm những người rảnh ở TẤT CẢ các giờ trong block này (intersection)
            const freeMembers = members.filter(m => {
                return blockHours.every(h => m.schedule[day] && m.schedule[day].includes(h));
            });

            if (freeMembers.length >= minPeople) {
                blocks.push({
                    day: day,
                    startHour: blockHours[0],
                    endHour: getNextHourString(blockHours[blockHours.length - 1]),
                    duration: minDur,
                    freeCount: freeMembers.length,
                    freeNames: freeMembers.map(m => m.name)
                });
            }
        }
    });
    return blocks;
}


function populateAdminDaysList() {
    const daysList = document.getElementById('admin-filter-days-list');
    if (!daysList) return;
    
    // Clear old except "all"
    const allCheckLabel = daysList.querySelector('.check-all-label');
    daysList.innerHTML = '';
    daysList.appendChild(allCheckLabel);
    
    const activeDays = getRoomDays();
    activeDays.forEach(day => {
        const lbl = document.createElement('label');
        lbl.className = 'check-item-label';
        lbl.innerHTML = `<input type="checkbox" class="admin-day-check" value="${day}"><span>${getRoomDayLabel(day)}</span>`;
        daysList.appendChild(lbl);
    });
}

function populateAdminHoursList() {
    const hoursList = document.getElementById('admin-filter-hours-list');
    if (!hoursList) return;
    
    // Clear old except "all"
    const allCheckLabel = hoursList.querySelector('.check-all-label');
    hoursList.innerHTML = '';
    hoursList.appendChild(allCheckLabel);
    
    HOURS.forEach(hour => {
        const nextHour = getNextHourString(hour);
        const lbl = document.createElement('label');
        lbl.className = 'check-item-label';
        lbl.innerHTML = `<input type="checkbox" class="admin-hour-check" value="${hour}"><span>${hour} - ${nextHour}</span>`;
        hoursList.appendChild(lbl);
    });
}

function setupAdminMemberCheckboxEvents() {
    const allCb = document.getElementById('admin-filter-member-all');
    
    // Re-query checkboxes because they are dynamic
    const getMemberCbs = () => document.querySelectorAll('.admin-member-check');
    
    if (allCb) {
        // Remove existing listener to prevent duplicate attachment if setup is called multiple times
        allCb.replaceWith(allCb.cloneNode(true));
        const newAllCb = document.getElementById('admin-filter-member-all');
        newAllCb.addEventListener('change', (e) => {
            const memberCbs = getMemberCbs();
            if (e.target.checked) {
                memberCbs.forEach(cb => {
                    cb.checked = false;
                    cb.closest('.check-item-label')?.classList.remove('is-selected');
                });
                state.adminFilters.memberIds = [];
            } else {
                const checkedCount = Array.from(memberCbs).filter(cb => cb.checked).length;
                if (checkedCount === 0) {
                    e.target.checked = true;
                }
            }
            renderAdminGrid();
            updateAdminDetails();
        });
    }
    
    const memberCbs = getMemberCbs();
    memberCbs.forEach(cb => {
        cb.addEventListener('change', (e) => {
            const label = cb.closest('.check-item-label');
            const newAllCb = document.getElementById('admin-filter-member-all');
            if (cb.checked) {
                label?.classList.add('is-selected');
                if (newAllCb) newAllCb.checked = false;
            } else {
                label?.classList.remove('is-selected');
            }
            
            const checkedCbs = Array.from(getMemberCbs()).filter(c => c.checked);
            state.adminFilters.memberIds = checkedCbs.map(c => c.value);
            
            if (state.adminFilters.memberIds.length === 0 && newAllCb) {
                newAllCb.checked = true;
            }
            
            renderAdminGrid();
            updateAdminDetails();
        });
    });
}

function setupDayCheckboxEvents() {
    const allCb = document.getElementById('admin-filter-day-all');
    
    // Re-query checkboxes because they are dynamic
    const getDayCbs = () => document.querySelectorAll('.admin-day-check');
    
    if (allCb) {
        allCb.replaceWith(allCb.cloneNode(true));
        const newAllCb = document.getElementById('admin-filter-day-all');
        newAllCb.addEventListener('change', (e) => {
            const dayCbs = getDayCbs();
            if (e.target.checked) {
                dayCbs.forEach(cb => {
                    cb.checked = false;
                    cb.closest('.check-item-label')?.classList.remove('is-selected');
                });
                state.adminFilters.days = [];
            } else {
                const checkedCount = Array.from(dayCbs).filter(cb => cb.checked).length;
                if (checkedCount === 0) {
                    e.target.checked = true;
                }
            }
            renderAdminGrid();
            updateAdminDetails();
        });
    }
    
    const dayCbs = getDayCbs();
    dayCbs.forEach(cb => {
        cb.addEventListener('change', (e) => {
            const label = cb.closest('.check-item-label');
            const newAllCb = document.getElementById('admin-filter-day-all');
            if (cb.checked) {
                label?.classList.add('is-selected');
                if (newAllCb) newAllCb.checked = false;
            } else {
                label?.classList.remove('is-selected');
            }
            
            const checkedCbs = Array.from(getDayCbs()).filter(c => c.checked);
            state.adminFilters.days = checkedCbs.map(c => c.value);
            
            if (state.adminFilters.days.length === 0 && newAllCb) {
                newAllCb.checked = true;
            }
            
            renderAdminGrid();
            updateAdminDetails();
        });
    });
}

function setupHourCheckboxEvents() {
    const allCb = document.getElementById('admin-filter-hour-all');
    
    // Re-query hour checks as they are generated dynamically
    const getHourCbs = () => document.querySelectorAll('.admin-hour-check');
    
    if (allCb) {
        allCb.addEventListener('change', (e) => {
            const hourCbs = getHourCbs();
            if (e.target.checked) {
                hourCbs.forEach(cb => {
                    cb.checked = false;
                    cb.closest('.check-item-label')?.classList.remove('is-selected');
                });
                state.adminFilters.hours = [];
            } else {
                const checkedCount = Array.from(hourCbs).filter(cb => cb.checked).length;
                if (checkedCount === 0) {
                    e.target.checked = true;
                }
            }
            renderAdminGrid();
            updateAdminDetails();
        });
    }
    
    // Since hour checkboxes are generated dynamically, we can use event delegation on parent
    const hoursList = document.getElementById('admin-filter-hours-list');
    if (hoursList) {
        hoursList.addEventListener('change', (e) => {
            if (e.target && e.target.classList.contains('admin-hour-check')) {
                const cb = e.target;
                const label = cb.closest('.check-item-label');
                const newAllCb = document.getElementById('admin-filter-hour-all');
                if (cb.checked) {
                    label?.classList.add('is-selected');
                    if (newAllCb) newAllCb.checked = false;
                } else {
                    label?.classList.remove('is-selected');
                }
                
                const checkedCbs = Array.from(getHourCbs()).filter(c => c.checked);
                state.adminFilters.hours = checkedCbs.map(c => c.value);
                
                if (state.adminFilters.hours.length === 0 && newAllCb) {
                    newAllCb.checked = true;
                }
                
                renderAdminGrid();
                updateAdminDetails();
            }
        });
    }
}

function renderHeatmapStats() {
    const daysBarsContainer = document.getElementById('heatmap-days-bars');
    const hoursBarsContainer = document.getElementById('heatmap-hours-bars');
    
    console.log('renderHeatmapStats called', { daysBarsContainer, hoursBarsContainer });
    
    if (!daysBarsContainer || !hoursBarsContainer) {
        console.log('Containers not found');
        return;
    }
    
    if (!state.room || !state.room.members || Object.keys(state.room.members).length === 0) {
        console.log('No room data or members');
        daysBarsContainer.innerHTML = '<div class="empty-state"><p>Chưa có dữ liệu</p></div>';
        hoursBarsContainer.innerHTML = '<div class="empty-state"><p>Chưa có dữ liệu</p></div>';
        return;
    }
    
    const memberIds = state.adminFilters.memberIds;
    const membersToConsider = memberIds.length > 0
        ? Object.values(state.room.members).filter(m => memberIds.includes(m.id))
        : Object.values(state.room.members);
    
    const filteredDays = state.adminFilters.days;
    const filteredHours = state.adminFilters.hours;
    const activeDays = filteredDays.length > 0 ? filteredDays : getRoomDays();
    const activeHours = filteredHours.length > 0 ? filteredHours : HOURS;
    
    console.log('Stats calculation', { activeDays, activeHours, membersCount: membersToConsider.length });
    
    // Calculate free slots by day
    const dayStats = {};
    activeDays.forEach(day => {
        let totalFree = 0;
        activeHours.forEach(hour => {
            const freeCount = membersToConsider.filter(m => m.schedule[day] && m.schedule[day].includes(hour)).length;
            totalFree += freeCount;
        });
        dayStats[day] = totalFree;
    });
    
    // Calculate free slots by hour
    const hourStats = {};
    activeHours.forEach(hour => {
        let totalFree = 0;
        activeDays.forEach(day => {
            const freeCount = membersToConsider.filter(m => m.schedule[day] && m.schedule[day].includes(hour)).length;
            totalFree += freeCount;
        });
        hourStats[hour] = totalFree;
    });
    
    console.log('Stats calculated', { dayStats, hourStats });
    
    // Find max values for scaling
    const maxDayFree = Math.max(...Object.values(dayStats), 1);
    const maxHourFree = Math.max(...Object.values(hourStats), 1);
    
    // Render day bars (column chart)
    let daysHtml = '<div class="heatmap-chart-container">';
    activeDays.forEach(day => {
        const value = dayStats[day] || 0;
        const heightPercent = (value / maxDayFree) * 100;
        daysHtml += `
            <div class="heatmap-bar-wrapper">
                <div class="heatmap-bar" style="height: ${heightPercent}%" title="${value} lượt rảnh"></div>
                <div class="heatmap-bar-value">${value}</div>
                <div class="heatmap-bar-label">${getRoomDayLabel(day).split(' ')[0]}</div>
            </div>
        `;
    });
    daysHtml += '</div>';
    daysBarsContainer.innerHTML = daysHtml;
    
    // Render hour bars (column chart)
    let hoursHtml = '<div class="heatmap-chart-container">';
    activeHours.forEach(hour => {
        const value = hourStats[hour] || 0;
        const heightPercent = (value / maxHourFree) * 100;
        hoursHtml += `
            <div class="heatmap-bar-wrapper">
                <div class="heatmap-bar" style="height: ${heightPercent}%" title="${value} lượt rảnh"></div>
                <div class="heatmap-bar-value">${value}</div>
                <div class="heatmap-bar-label">${hour}</div>
            </div>
        `;
    });
    hoursHtml += '</div>';
    hoursBarsContainer.innerHTML = hoursHtml;
    
    console.log('Heatmap rendered');
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const toastIcon = toast.querySelector('.toast-icon');
    const toastMessage = toast.querySelector('.toast-message');
    
    if (type === 'error') {
        toast.classList.add('toast-error');
        toastIcon.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i>';
    } else {
        toast.classList.remove('toast-error');
        toastIcon.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
    }
    
    toastMessage.textContent = message;
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3500);
}
