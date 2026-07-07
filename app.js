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
    
    const memberIds = state.adminFilters.memberIds;
    const filteredDays = state.adminFilters.days;
    const filteredHours = state.adminFilters.hours;
    const hasFilter = memberIds.length > 0 || filteredDays.length > 0 || filteredHours.length > 0;
    
    if (!hasFilter) {
        detailsContent.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-magnifying-glass"></i>
                <p>Hãy chọn bộ lọc để phân tích chi tiết. Click vào ô trên lịch để xem danh sách bình chọn.</p>
            </div>
        `;
        return;
    }

    const membersToConsider = memberIds.length > 0
        ? Object.values(state.room.members).filter(m => memberIds.includes(m.id))
        : Object.values(state.room.members);

    if (membersToConsider.length === 0) {
        detailsContent.innerHTML = `<div class="empty-state"><p>Không có thành viên nào thỏa mãn bộ lọc.</p></div>`;
        return;
    }

    const activeDays = filteredDays.length > 0 ? filteredDays : getRoomDays();
    const activeHours = filteredHours.length > 0 ? filteredHours : HOURS;
    const minDur = state.adminFilters.minDuration || 1;
    const minFree = state.adminFilters.minFree || 1;

    let topBlocks = [];
    let topSlots = [];

    if (minDur > 1) {
        const blocks = findConsecutiveBlocks(membersToConsider, activeDays, activeHours, minDur, minFree);
        blocks.sort((a, b) => b.freeCount - a.freeCount);
        topBlocks = blocks.slice(0, 5);
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
        topSlots = allSlots.slice(0, 5);
    }

    if (topBlocks.length === 0 && topSlots.length === 0) {
        detailsContent.innerHTML = `<div class="empty-state"><p>Không tìm thấy khung giờ rảnh nào phù hợp bộ lọc.</p></div>`;
        return;
    }

    let html = `<h4><i class="fa-solid fa-ranking-star"></i> Khung giờ gợi ý</h4><ul class="suggestion-list">`;
    
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
                            <span class="suggestion-tier-badge tier-badge-${tier}">${pct}%</span>
                        </div>
                    </div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">
                        <strong>Rảnh:</strong> ${block.freeNames.join(', ')} (${block.freeCount}/${membersToConsider.length} người)
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
                        <strong style="color: var(--text-primary);">#${index + 1}. ${getRoomDayLabel(slot.day)} · ${slot.hour}</strong>
                        <span class="suggestion-tier-badge tier-badge-${tier}">${pct}%</span>
                    </div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">
                        <strong>Rảnh:</strong> ${slot.freeNames.join(', ')} (${slot.freeCount}/${slot.total} người)
                    </div>
                </li>
            `;
        });
    }
    
    html += `</ul>`;
    detailsContent.innerHTML = html;
}

// Add popup helpers (place after palette generation)
function createCellPopupIfNeeded() {
    if (document.getElementById('cell-popup')) return;
    const popup = document.createElement('div');
    popup.id = 'cell-popup';
    popup.style.position = 'absolute';
    popup.style.zIndex = 9999;
    popup.style.minWidth = '200px';
    popup.style.maxWidth = '360px';
    popup.style.padding = '0.6rem';
    popup.style.borderRadius = '8px';
    popup.style.boxShadow = '0 8px 24px rgba(2,6,23,0.6)';
    popup.style.background = 'var(--bg-elevated, rgba(10,10,12,0.9))';
    popup.style.color = 'var(--text-primary)';
    popup.style.display = 'none';
    popup.style.fontSize = '0.9rem';
    popup.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(popup);

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideCellPopup();
    });
    document.addEventListener('click', () => hideCellPopup());
}

function showCellPopup(anchorCell, htmlContent) {
    createCellPopupIfNeeded();
    const popup = document.getElementById('cell-popup');
    popup.innerHTML = htmlContent;

    popup.style.display = 'block';
    popup.style.opacity = '0';
    popup.style.transform = 'translateY(-6px)';

    const rect = anchorCell.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const margin = 8;
    // Prefer right side
    let left = rect.right + margin + window.scrollX;
    if (left + popupRect.width + margin > window.innerWidth + window.scrollX) {
        left = rect.left - popupRect.width - margin + window.scrollX;
    }
    if (left < window.scrollX + margin) left = window.scrollX + margin;

    let top = rect.top + window.scrollY + (rect.height / 2) - (popupRect.height / 2);
    const minTop = window.scrollY + margin;
    const maxTop = window.scrollY + window.innerHeight - popupRect.height - margin;
    if (top < minTop) top = minTop;
    if (top > maxTop) top = maxTop;

    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;

    requestAnimationFrame(() => {
        popup.style.transition = 'opacity 160ms ease, transform 160ms ease';
        popup.style.opacity = '1';
        popup.style.transform = 'translateY(0)';
    });
}

function hideCellPopup() {
    const popup = document.getElementById('cell-popup');
    if (!popup || popup.style.display === 'none') return;
    popup.style.transition = 'opacity 140ms ease, transform 140ms ease';
    popup.style.opacity = '0';
    popup.style.transform = 'translateY(-6px)';
    setTimeout(() => {
        if (popup) popup.style.display = 'none';
    }, 160);
}

function generateCellDetailHtml(day, hour, membersToConsider) {
    const freeMembers = membersToConsider.filter(m => m.schedule[day] && m.schedule[day].includes(hour));
    const busyMembers = membersToConsider.filter(m => !(m.schedule[day] && m.schedule[day].includes(hour)));

    const freeHtml = freeMembers.length
        ? `<ul style="margin:0; padding-left:0.6rem; max-height:220px; overflow:auto;">${freeMembers.map(m => `<li style="padding:0.25rem 0;"><strong>${m.name}</strong></li>`).join('')}</ul>`
        : `<div style="color:var(--text-secondary);">Không có thành viên rảnh.</div>`;

    const busyHtml = busyMembers.length ? `<div style="margin-top:0.5rem; color:var(--text-secondary); font-size:0.85rem;">Bận: ${busyMembers.map(m => m.name).join(', ')}</div>` : '';

    return `
        <div>
            <div style="display:flex; gap:0.5rem; align-items:center; margin-bottom:0.5rem;">
                <strong style="font-size:0.95rem;">${getRoomDayLabel(day)}</strong>
                <span style="font-size:0.85rem; color:var(--text-secondary);">${hour} - ${getNextHourString(hour)}</span>
            </div>
            ${freeHtml}
            ${busyHtml}
            <div style="margin-top:0.6rem; display:flex; gap:0.5rem; justify-content:flex-end;">
                <button class="btn btn-sm btn-copy-slot" data-day="${day}" data-hour="${hour}" style="font-size:0.8rem;">Sao chép</button>
                <button class="btn btn-sm btn-close-popup" style="font-size:0.8rem;">Đóng</button>
            </div>
        </div>
    `;
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
    
    if (btnResetFilters) {
        btnResetFilters.addEventListener('click', () => {
            state.adminFilters.memberIds = [];
            state.adminFilters.days = [];
            state.adminFilters.hours = [];
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
        if (elem && elem.classList.contains('grid-slot-cell') && !elem.classList.contains('admin-cell')) {
            if (dragMode === 'free') {
                elem.classList.add('state-free');
            } else {
                elem.classList.remove('state-free');
            }
            renderMemberGridDensity();
        }
    };

    // Admin grid touch dragging
    const handleAdminTouchMove = (e) => {
        if (!isAdminDragging) return;
        e.preventDefault(); // Ngăn cuộn trang
        const touch = e.touches[0];
        const elem = document.elementFromPoint(touch.clientX, touch.clientY);
        if (elem && elem.classList.contains('admin-cell')) {
            const day = elem.getAttribute('data-admin-day');
            const hour = elem.getAttribute('data-admin-hour');
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
