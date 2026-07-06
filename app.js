/**
 * TeamSync - Team Scheduler Application Logic (Multi-room Edition)
 * 
 * CẤU HÌNH FIREBASE Ở ĐÂY:
 * Nếu muốn chạy online đồng bộ giữa nhiều người:
 * Điền URL Realtime Database của bạn vào đây (ví dụ: "https://ten-du-an-default-rtdb.firebaseio.com/")
 * Nếu để trống "", ứng dụng sẽ chạy offline sử dụng bộ nhớ trình duyệt (localStorage).
 */
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

// Bảng màu 60 sắc độ dựa trên palette mới
// Anchors: dark -> light (sẽ được đảo ngược để PALETTE[0] = nhạt nhất, PALETTE[59] = đậm nhất)
const PALETTE_ANCHORS = [
    '#401565', '#402A7E', '#464898', '#687EB1', '#91B2CB', '#C0DFE4', '#F5FEFD'
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
        memberIds: [],          // [] = tất cả; [id1, id2] = lọc những id này
        mandatoryMemberIds: [], // [id1, ...] = bắt buộc các thành viên này phải rảnh
        days: [],               // [] = tất cả; ['Monday', ...] = lọc các ngày
        hours: [],              // [] = tất cả; ['08:00', ...] = lọc các giờ
        minFree: 0,             // 0 = không lọc; K = chỉ hiện các ô có >= K người rảnh
        minDuration: 1,         // số khung giờ liên tiếp tối thiểu (1 = mặc định)
        timeRangeStart: null,   // giờ bắt đầu khoảng lọc (null = không lọc)
        timeRangeEnd: null,     // giờ kết thúc khoảng lọc (null = không lọc)
        activePreset: null      // tên preset đang kích hoạt
    },
    selectedAdminCells: [], // Array of {day, hour}
    isOfflineMode: true,
    hasPendingSync: false,  // true khi có dữ liệu chưa đồng bộ lên Cloud
    lastSuggestionsHash: ''  // hash nội dung gợi ý, tránh re-render không cần thiết
};

// Biến điều khiển thao tác kéo chuột tô lịch (thành viên)
let isDragging = false;
let dragMode = null; // 'free' hoặc 'busy'

// Biến điều khiển kéo chuột cho Admin
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
        
        // Sử dụng UUID (Cách 1) kết hợp lưu localStorage (Cách 2 đã có sẵn)
        const generateUUID = () => {
            return (typeof crypto !== 'undefined' && crypto.randomUUID) 
                ? crypto.randomUUID() 
                : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
        };
        const roomId = 'room_' + generateUUID();
        
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
    populateTimeRangeSelects();
    
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
            // Nếu có dữ liệu chưa sync, thử lại trước
            if (state.hasPendingSync && state.room) {
                console.log('[Sync] Đang thử đồng bộ lại dữ liệu chưa được lưu...');
                await saveRoomDataToDB();
                if (!state.hasPendingSync) {
                    showToast('✅ Đã đồng bộ Cloud thành công!');
                }
            }
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
            // Nếu Firebase không có dữ liệu, thử fallback localStorage
            if (!state.isOfflineMode) {
                const localRooms = getLocalRooms();
                roomData = localRooms[state.currentRoomId];
            }
        }
        if (!roomData) {
            if (!isBackground) {
                showToast("Phòng đặt lịch không tồn tại!", "error");
                setTimeout(() => {
                    window.location.href = window.location.pathname;
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
        }
        
        return true;
    } catch (error) {
        console.error("Lỗi tải phòng:", error);
        if (isBackground) {
            // Nếu background poll lỗi, thử dùng dữ liệu localStorage để không gây gián đoạn UI
            const localRooms = getLocalRooms();
            const localData = localRooms[state.currentRoomId];
            if (localData) {
                state.room = localData;
                renderAdminGrid();
                updateAdminDetails();
            }
        } else {
            showToast("Lỗi kết nối — thử lại...", "error");
        }
        return false;
    }
}

// Cập nhật số lượng người đã điền lịch
function updateMemberCounts() {
    const count = Object.keys(state.room.members).length;
    document.getElementById('member-count-value').textContent = count;
    document.getElementById('admin-total-members-count').textContent = count;
    
    // Cập nhật giới hạn tối đa cho thanh trượt lọc số người rảnh tối thiểu
    const sliderMinFree = document.getElementById('admin-filter-min-free');
    if (sliderMinFree) {
        sliderMinFree.max = count;
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
        const isMandatory = state.adminFilters.mandatoryMemberIds.includes(member.id);
        
        lbl.innerHTML = `
            <input type="checkbox" class="admin-member-check" value="${member.id}" ${isChecked ? 'checked' : ''}>
            <span class="member-name-span">${member.name}</span>
            <button type="button" class="btn-toggle-mandatory ${isMandatory ? 'is-active' : ''}" title="Đánh dấu bắt buộc có mặt" data-id="${member.id}">
                <i class="${isMandatory ? 'fa-solid' : 'fa-regular'} fa-star star-icon"></i>
            </button>
        `;
        
        if (isChecked && state.adminFilters.memberIds.length > 0) lbl.classList.add('is-selected');
        if (isMandatory) lbl.classList.add('has-mandatory');
        
        // Gắn sự kiện click cho ngôi sao trực tiếp tại đây
        const starBtn = lbl.querySelector('.btn-toggle-mandatory');
        starBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const id = starBtn.dataset.id;
            const starIcon = starBtn.querySelector('.star-icon');
            
            const idx = state.adminFilters.mandatoryMemberIds.indexOf(id);
            if (idx > -1) {
                state.adminFilters.mandatoryMemberIds.splice(idx, 1);
                starBtn.classList.remove('is-active');
                starIcon.className = 'fa-regular fa-star star-icon';
                lbl.classList.remove('has-mandatory');
            } else {
                state.adminFilters.mandatoryMemberIds.push(id);
                starBtn.classList.add('is-active');
                starIcon.className = 'fa-solid fa-star star-icon';
                lbl.classList.add('has-mandatory');
            }
            
            renderAdminGrid();
            updateAdminDetails();
        });

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
    
    // Reset lựa chọn thành viên và giao diện về trạng thái ban đầu sau khi lưu
    state.currentMemberId = null;
    const memberSelect = document.getElementById('member-select');
    if (memberSelect) memberSelect.value = "";
    const currentMemberName = document.getElementById('current-member-name');
    if (currentMemberName) currentMemberName.textContent = "Chưa chọn";
    const scheduleSection = document.getElementById('schedule-section');
    if (scheduleSection) scheduleSection.classList.add('disabled-state');
    
    // Xóa các ô màu xanh đã chọn trên lưới
    document.querySelectorAll('#member-schedule-grid .grid-slot-cell').forEach(cell => {
        cell.classList.remove('state-free');
    });
    
    await loadRoomData(true);
}

// Ghi dữ liệu phòng hiện tại xuống DB (Local hoặc Firebase)
async function saveRoomDataToDB() {
    // Luôn lưu LocalStorage trước như bản backup
    const rooms = getLocalRooms();
    rooms[state.currentRoomId] = state.room;
    saveLocalRooms(rooms);

    if (state.isOfflineMode) return;

    // Thử ghi Firebase, retry tối đa 3 lần
    const MAX_RETRY = 3;
    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
        try {
            const response = await fetch(`${FIREBASE_DB_URL}rooms/${state.currentRoomId}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(state.room)
            });
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Firebase trả lỗi ${response.status}: ${errText}`);
            }
            // Thành công — xóa cờ pending nếu có
            state.hasPendingSync = false;
            return;
        } catch (error) {
            console.warn(`[Sync] Lần thử ${attempt}/${MAX_RETRY} thất bại:`, error.message);
            if (attempt < MAX_RETRY) {
                await new Promise(r => setTimeout(r, 800 * attempt)); // exponential backoff nhỏ
            }
        }
    }

    // Tất cả retry đều thất bại — đánh dấu pending để sync lại sau
    state.hasPendingSync = true;
    showToast("⚠️ Lưu Cloud thất bại — đã lưu tạm offline. Sẽ tự đồng bộ lại khi có mạng.", "error");
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
                
                e.preventDefault();
            });
            
            slotCell.addEventListener('mouseover', () => {
                if (!isDragging || state.currentMemberId === null) return;
                
                if (dragMode === 'free') {
                    slotCell.classList.add('state-free');
                } else {
                    slotCell.classList.remove('state-free');
                }
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

    // Tìm top slots để highlight (best-slot)
    const bestSlotKeys = computeBestSlotKeys(membersToShow, filteredDays, filteredHours);

    cells.forEach(cell => {
        const day = cell.getAttribute('data-admin-day');
        const hour = cell.getAttribute('data-admin-hour');

        // Reset classes and inline styles
        cell.className = 'grid-slot-cell admin-cell';
        cell.style.backgroundColor = '';
        cell.style.color = '';

        if (state.selectedAdminCells.some(c => c.day === day && c.hour === hour)) {
            cell.classList.add('selected-cell');
        }

        // Highlight filtered days/hours (make non-filtered ones faded)
        const isDayFiltered = filteredDays.length > 0 && !filteredDays.includes(day);
        const isHourFiltered = filteredHours.length > 0 && !filteredHours.includes(hour);

        // Tính số người rảnh trong nhóm được lọc
        let freeCount = 0;
        membersToShow.forEach(member => {
            if (member.schedule[day] && member.schedule[day].includes(hour)) {
                freeCount++;
            }
        });

        // Kiểm tra xem các thành viên bắt buộc có mặt (Mandatory Members) có rảnh không
        const mandatoryMemberIds = state.adminFilters.mandatoryMemberIds;
        let isMandatoryMissing = false;
        if (mandatoryMemberIds.length > 0) {
            isMandatoryMissing = mandatoryMemberIds.some(id => {
                const member = state.room.members[id];
                return !member || !member.schedule[day] || !member.schedule[day].includes(hour);
            });
        }

        // Lọc theo số người rảnh tối thiểu (Min Availability)
        const isBelowMinFree = freeCount < state.adminFilters.minFree;

        // Kiểm tra lọc theo minDuration (consecutive block)
        const minDur = state.adminFilters.minDuration || 1;
        let isConsecutiveShort = false;
        if (minDur > 1 && freeCount > 0 && !isMandatoryMissing && !isBelowMinFree && !isDayFiltered && !isHourFiltered) {
            // Kiểm tra xem ô này có nằm trong block liên tiếp đủ dài không
            isConsecutiveShort = !isInConsecutiveBlock(membersToShow, day, hour, state.adminFilters.minFree || 1, minDur);
        }

        // Cập nhật hiển thị text
        if (isMandatoryMissing) {
            cell.textContent = '🔒';
        } else if (isBelowMinFree || isConsecutiveShort) {
            cell.textContent = '';
        } else {
            cell.textContent = freeCount > 0 ? freeCount : '';
        }

        // Áp dụng màu sắc dựa trên 60 cấp độ của palette
        let colorIndex = 0;
        if (effectiveTotal > 0 && freeCount > 0 && !isMandatoryMissing && !isBelowMinFree && !isConsecutiveShort) {
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

        // Điều chỉnh độ mờ (opacity) dựa trên các bộ lọc
        if (isDayFiltered || isHourFiltered || isMandatoryMissing || isBelowMinFree || isConsecutiveShort) {
            cell.style.opacity = '0.12';
        } else {
            cell.style.opacity = '';
        }

        // Best slot highlight
        const slotKey = `${day}__${hour}`;
        if (bestSlotKeys.has(slotKey) && !isDayFiltered && !isHourFiltered && !isMandatoryMissing && !isBelowMinFree && !isConsecutiveShort) {
            cell.classList.add('best-slot');
        }
    });

    // Render heatmap sau khi cập nhật grid
    renderHeatmap(membersToShow, filteredDays, filteredHours);
}

// Kiểm tra xem khung giờ (day, hour) có nằm trong 1 block liên tiếp >= minDur khung của >= minPeople người không
function isInConsecutiveBlock(members, day, hour, minPeople, minDur) {
    const hourIndex = HOURS.indexOf(hour);
    if (hourIndex === -1) return false;

    // Tìm block bắt đầu sớm nhất có thể chứa giờ này
    for (let start = Math.max(0, hourIndex - minDur + 1); start <= hourIndex; start++) {
        let blockOk = true;
        for (let k = 0; k < minDur; k++) {
            const h = HOURS[start + k];
            if (!h) { blockOk = false; break; }
            const cnt = members.filter(m => m.schedule[day] && m.schedule[day].includes(h)).length;
            if (cnt < minPeople) { blockOk = false; break; }
        }
        if (blockOk) return true;
    }
    return false;
}

// Tính top N slot keys để highlight best-slot
function computeBestSlotKeys(members, filteredDays, filteredHours) {
    if (members.length === 0) return new Set();
    const activeDays = filteredDays.length > 0 ? filteredDays : getRoomDays();
    const activeHours = filteredHours.length > 0 ? filteredHours : HOURS;
    const slots = [];
    activeDays.forEach(day => {
        activeHours.forEach(hour => {
            const cnt = members.filter(m => m.schedule[day] && m.schedule[day].includes(hour)).length;
            if (cnt > 0) slots.push({ key: `${day}__${hour}`, cnt });
        });
    });
    slots.sort((a, b) => b.cnt - a.cnt);
    const topCnt = slots.length > 0 ? slots[0].cnt : 0;
    // Highlight tất cả ô có cnt == topCnt (có thể nhiều hơn 3)
    const topKeys = new Set();
    for (const s of slots) {
        if (s.cnt === topCnt) topKeys.add(s.key);
        if (topKeys.size >= 5) break;
    }
    return topKeys;
}

// Render heatmap bars (day & hour)
function renderHeatmap(members, filteredDays, filteredHours) {
    const daysEl = document.getElementById('heatmap-days-bars');
    const hoursEl = document.getElementById('heatmap-hours-bars');
    if (!daysEl || !hoursEl) return;

    const activeDays = getRoomDays();
    const activeHours = HOURS;

    // Day stats
    const dayStats = activeDays.map(day => {
        let total = 0;
        activeHours.forEach(hour => {
            total += members.filter(m => m.schedule[day] && m.schedule[day].includes(hour)).length;
        });
        return { label: getRoomDayLabel(day).replace('Thứ ', 'T').replace('Chủ Nhật', 'CN'), value: total, day };
    });
    const maxDay = Math.max(...dayStats.map(d => d.value), 1);

    daysEl.innerHTML = '';
    dayStats.forEach(d => {
        const pct = Math.round((d.value / maxDay) * 100);
        const isFiltered = filteredDays.length > 0 && !filteredDays.includes(d.day);
        const wrap = document.createElement('div');
        wrap.className = 'heatmap-bar-wrap';
        const bar = document.createElement('div');
        bar.className = 'heatmap-bar';
        bar.style.height = `${Math.max(2, pct * 0.38)}px`;
        bar.style.background = isFiltered
            ? 'rgba(255,255,255,0.08)'
            : `rgba(70,72,152, ${0.2 + 0.8 * (d.value / maxDay)})`;
        bar.title = `${d.label}: ${d.value} lượt rảnh`;
        const lbl = document.createElement('div');
        lbl.className = 'heatmap-bar-label';
        lbl.textContent = d.label;
        const cnt = document.createElement('div');
        cnt.className = 'heatmap-bar-count';
        cnt.textContent = d.value > 0 ? d.value : '';
        wrap.appendChild(bar);
        wrap.appendChild(lbl);
        wrap.appendChild(cnt);
        daysEl.appendChild(wrap);
    });

    // Hour stats
    const hourStats = activeHours.map(hour => {
        let total = 0;
        activeDays.forEach(day => {
            total += members.filter(m => m.schedule[day] && m.schedule[day].includes(hour)).length;
        });
        return { label: hour.replace(':00', 'h'), value: total, hour };
    });
    const maxHour = Math.max(...hourStats.map(h => h.value), 1);

    hoursEl.innerHTML = '';
    hourStats.forEach(h => {
        const pct = Math.round((h.value / maxHour) * 100);
        const isFiltered = filteredHours.length > 0 && !filteredHours.includes(h.hour);
        const wrap = document.createElement('div');
        wrap.className = 'heatmap-bar-wrap';
        const bar = document.createElement('div');
        bar.className = 'heatmap-bar';
        bar.style.height = `${Math.max(2, pct * 0.38)}px`;
        bar.style.background = isFiltered
            ? 'rgba(255,255,255,0.08)'
            : `rgba(145,178,203, ${0.15 + 0.85 * (h.value / maxHour)})`;
        bar.title = `${h.label}: ${h.value} lượt rảnh`;
        const lbl = document.createElement('div');
        lbl.className = 'heatmap-bar-label';
        lbl.textContent = h.label;
        const cnt = document.createElement('div');
        cnt.className = 'heatmap-bar-count';
        cnt.textContent = h.value > 0 ? h.value : '';
        wrap.appendChild(bar);
        wrap.appendChild(lbl);
        wrap.appendChild(cnt);
        hoursEl.appendChild(wrap);
    });
}

function updateAdminDetails() {
    if (!state.room) return;
    
    // Luôn cập nhật phần gợi ý lịch họp tối ưu
    updateAdminSuggestions();

    const detailsContent = document.getElementById('admin-details-content');
    
    const memberIds = state.adminFilters.memberIds;
    const filteredDays = state.adminFilters.days;
    const filteredHours = state.adminFilters.hours;
    
    const hasFilter = memberIds.length > 0 || filteredDays.length > 0 || filteredHours.length > 0;
    
    // If admin selected one or more cells, show the list of members free in ALL those slots
    if (state.selectedAdminCells && state.selectedAdminCells.length > 0) {
        const membersToConsider = memberIds.length > 0
            ? Object.values(state.room.members).filter(m => memberIds.includes(m.id))
            : Object.values(state.room.members);
        
        // Free members: must be free in EVERY selected cell
        const freeMembers = membersToConsider.filter(m => {
            return state.selectedAdminCells.every(cell => m.schedule[cell.day] && m.schedule[cell.day].includes(cell.hour));
        });
        
        // Busy members: busy in AT LEAST ONE selected cell
        const busyMembers = membersToConsider.filter(m => {
            return state.selectedAdminCells.some(cell => !m.schedule[cell.day] || !m.schedule[cell.day].includes(cell.hour));
        });
        
        const freeHtml = freeMembers.length > 0
            ? freeMembers.map(m => `<li class="member-list-item free-member" style="border-left: 3px solid var(--color-success);"><span class="status-icon" style="color: var(--color-success); margin-right: 0.5rem;"><i class="fa-solid fa-circle-check"></i></span><strong>${m.name}</strong></li>`).join('')
            : '<p class="filter-tip" style="margin-left: 0.5rem;">Không có thành viên rảnh toàn bộ thời gian chọn.</p>';
            
        const busyHtml = busyMembers.length > 0
            ? busyMembers.map(m => `<li class="member-list-item busy-member" style="border-left: 3px solid var(--color-danger); color: var(--text-muted);"><span class="status-icon" style="color: var(--color-danger); margin-right: 0.5rem;"><i class="fa-solid fa-circle-xmark"></i></span><strong>${m.name}</strong></li>`).join('')
            : '<p class="filter-tip" style="margin-left: 0.5rem;">Không có thành viên bận.</p>';
        
        // Sort selected cells by day then hour
        const sortedCells = [...state.selectedAdminCells].sort((a, b) => {
            if (a.day !== b.day) return getRoomDays().indexOf(a.day) - getRoomDays().indexOf(b.day);
            return HOURS.indexOf(a.hour) - HOURS.indexOf(b.hour);
        });
        
        // Display summary of selected slots
        const selectedSummary = sortedCells.map(c => `<strong>${getRoomDayLabel(c.day)}</strong> ${c.hour}`).join('<br>');
        const slotCountLabel = state.selectedAdminCells.length > 1 ? `<div style="font-size: 0.8rem; margin-top: 0.3rem;">(Đã chọn ${state.selectedAdminCells.length} khung giờ)</div>` : '';
        
        detailsContent.innerHTML = `
            <div class="detail-section">
                <div style="margin-bottom: 1rem; font-size: 0.95rem; color: var(--text-primary); text-align: center;">
                    <i class="fa-regular fa-clock" style="color: var(--color-success); margin-right: 0.4rem;"></i>
                    ${selectedSummary}
                    ${slotCountLabel}
                </div>
                
                <h3 class="detail-title" style="margin-top: 0.5rem;"><i class="fa-solid fa-check" style="color: var(--color-success); margin-right: 0.4rem;"></i> Rảnh (${freeMembers.length})</h3>
                <ul class="member-list" style="max-height: 150px; overflow:auto; margin-bottom: 1.25rem;">
                    ${freeHtml}
                </ul>
                
                <h3 class="detail-title"><i class="fa-solid fa-xmark" style="color: var(--color-danger); margin-right: 0.4rem;"></i> Bận (${busyMembers.length})</h3>
                <ul class="member-list" style="max-height: 150px; overflow:auto;">
                    ${busyHtml}
                </ul>
            </div>
        `;
        return;
    }
    
    // Default behavior: if no cell selected and no filters -> show empty guidance
    if (!hasFilter) {
        detailsContent.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-magnifying-glass"></i>
                <p>Hãy chọn bộ lọc hoặc click trực tiếp ô trên lưới để phân tích chi tiết.</p>
            </div>
        `;
        return;
    }
    
    // Lấy danh sách thành viên đang lọc
    const membersToAnalyze = memberIds.length > 0
        ? Object.values(state.room.members).filter(m => memberIds.includes(m.id))
        : Object.values(state.room.members);
    
    const daysToAnalyze = filteredDays.length > 0 ? filteredDays : getRoomDays();
    const hoursToAnalyze = filteredHours.length > 0 ? filteredHours : HOURS;
    
    // Tính toán lịch rảnh CHUNG (các khung giờ mà TẤT CẢ thành viên lọc đều rảnh)
    const commonFreeSlots = [];
    daysToAnalyze.forEach(day => {
        hoursToAnalyze.forEach(hour => {
            const allFree = membersToAnalyze.every(m => m.schedule[day] && m.schedule[day].includes(hour));
            if (allFree && membersToAnalyze.length > 0) {
                commonFreeSlots.push({ day, hour });
            }
        });
    });
    
    const memberNamesHtml = membersToAnalyze.map(m => `<span class="detail-badge">${m.name}</span>`).join(' ');
    const dayLabels = filteredDays.length > 0 ? filteredDays.map(d => getRoomDayLabel(d)).join(', ') : 'Tất cả ngày';
    const hourLabels = filteredHours.length > 0 ? filteredHours.map(h => `${h}-${getNextHourString(h)}`).join(', ') : 'Tất cả giờ';
    
    // Nhóm slot chung theo ngày
    const groupedByDay = {};
    commonFreeSlots.forEach(slot => {
        if (!groupedByDay[slot.day]) groupedByDay[slot.day] = [];
        groupedByDay[slot.day].push(slot.hour);
    });
    
    const commonSlotsHtml = Object.keys(groupedByDay).length > 0
        ? Object.entries(groupedByDay).map(([day, hours]) => `
            <li class="member-list-item free-member" style="flex-direction: column; align-items: flex-start; gap: 0.2rem;">
                <strong>${getRoomDayLabel(day)}</strong>
                <span style="font-size: 0.8rem; color: var(--text-secondary)">${hours.map(h => `${h}-${getNextHourString(h)}`).join(', ')}</span>
            </li>
        `).join('')
        : '<p class="filter-tip">Không có khung giờ rảnh chung nào.</p>';
    
    const htmlContent = `
        <div class="detail-section">
            <h3 class="detail-title">Thành viên đang phân tích</h3>
            <div style="margin-bottom: 0.75rem; display: flex; flex-wrap: wrap; gap: 0.35rem;">
                ${memberNamesHtml || '<span class="detail-badge">Tất cả</span>'}
            </div>
            
            <h3 class="detail-title">Bộ lọc</h3>
            <div class="detail-badge slot-badge" style="margin-bottom: 0.35rem;">${dayLabels}</div>
            <div class="detail-badge slot-badge">${hourLabels}</div>
            
            <div class="detail-stat" style="margin-top: 1rem;">
                <span class="number">${commonFreeSlots.length}</span>
                <span class="total">khung giờ rảnh chung</span>
            </div>
            
            <h3 class="detail-title">Giờ rảnh CHUNG (${membersToAnalyze.length > 0 ? 'cả ' + membersToAnalyze.length + ' người' : 'tất cả'})</h3>
            ${Object.keys(groupedByDay).length > 0 ? `<ul class="member-list" style="max-height: 250px;">${commonSlotsHtml}</ul>` : commonSlotsHtml}
        </div>
    `;
    
    detailsContent.innerHTML = htmlContent;
}

// Tính toán và hiển thị gợi ý khung giờ tối ưu cho admin
function updateAdminSuggestions() {
    if (!state.room) return;
    const suggestionsContent = document.getElementById('admin-suggestions-content');
    if (!suggestionsContent) return;

    const members = Object.values(state.room.members);

    // Tạo hash nội dung đơn giản để phát hiện thay đổi, tránh giật do re-render liên tục
    const filterKey = JSON.stringify({
        memberIds: state.adminFilters.memberIds,
        days: state.adminFilters.days,
        hours: state.adminFilters.hours,
        minDuration: state.adminFilters.minDuration,
        memberCount: members.length,
        scheduleSnapshot: members.map(m => ({
            id: m.id,
            days: Object.entries(m.schedule || {}).map(([d, hs]) => d + ':' + (hs || []).length).join('|')
        }))
    });
    if (filterKey === state.lastSuggestionsHash) return; // không thay đổi, bỏ qua
    state.lastSuggestionsHash = filterKey;

    if (members.length === 0) {
        suggestionsContent.innerHTML = `<div class="empty-state"><p>Chưa có thành viên nào điền lịch biểu.</p></div>`;
        return;
    }

    // Lọc thành viên theo bộ lọc admin
    const memberIds = state.adminFilters.memberIds;
    const membersToConsider = memberIds.length > 0
        ? members.filter(m => memberIds.includes(m.id))
        : members;

    if (membersToConsider.length === 0) {
        suggestionsContent.innerHTML = `<div class="empty-state"><p>Không có thành viên nào phù hợp bộ lọc.</p></div>`;
        return;
    }

    const activeDays = state.adminFilters.days.length > 0 ? state.adminFilters.days : getRoomDays();
    const activeHours = state.adminFilters.hours.length > 0 ? state.adminFilters.hours : HOURS;
    const minDur = state.adminFilters.minDuration || 1;

    // Tính slot scores
    const allSlots = [];
    activeDays.forEach(day => {
        activeHours.forEach(hour => {
            let freeCount = 0;
            const freeNames = [];
            membersToConsider.forEach(m => {
                if (m.schedule[day] && m.schedule[day].includes(hour)) {
                    freeCount++;
                    freeNames.push(m.name);
                }
            });
            allSlots.push({ day, hour, freeCount, freeNames, total: membersToConsider.length });
        });
    });

    // Tìm các BLOCK liên tiếp (nhóm khung giờ liên tiếp cùng ngày)
    const blocks = findConsecutiveBlocks(membersToConsider, activeDays, activeHours, minDur);

    // Sắp xếp block theo score (avgFreeCount * duration)
    blocks.sort((a, b) => (b.avgFree * b.duration) - (a.avgFree * a.duration));

    // Top 5 blocks tốt nhất
    const topBlocks = blocks.filter(b => b.avgFree > 0).slice(0, 5);

    // Fallback: nếu minDur=1 hoặc không có block đủ dài, hiện slot đơn
    let topSlots = [];
    if (topBlocks.length === 0) {
        allSlots.sort((a, b) => b.freeCount - a.freeCount);
        topSlots = allSlots.filter(s => s.freeCount > 0).slice(0, 5);
    }

    if (topBlocks.length === 0 && topSlots.length === 0) {
        suggestionsContent.innerHTML = `<div class="empty-state"><p>Không tìm thấy khung giờ rảnh nào phù hợp bộ lọc.</p></div>`;
        return;
    }

    // Tính thành viên linh hoạt nhất
    const memberStats = membersToConsider.map(m => {
        let count = 0;
        activeDays.forEach(day => { if (m.schedule[day]) count += m.schedule[day].length; });
        return { name: m.name, count };
    });
    memberStats.sort((a, b) => b.count - a.count);
    const mostFlexibleMember = memberStats[0];

    // Tính thành viên khó xếp lịch nhất (ít rảnh nhất)
    const leastFlexible = memberStats[memberStats.length - 1];

    let html = `<div class="detail-section">`;
    html += `<h3 class="detail-title">Top ${topBlocks.length > 0 ? topBlocks.length : topSlots.length} Khung Giờ Tối Ưu Nhất</h3>`;
    html += `<ul class="member-list" style="margin-bottom: 1.25rem; max-height: none;">`;

    if (topBlocks.length > 0) {
        topBlocks.forEach((block, index) => {
            const pct = Math.round((block.avgFree / membersToConsider.length) * 100);
            const tier = pct >= 100 ? 'gold' : pct >= 70 ? 'green' : 'blue';
            const endHour = HOURS[HOURS.indexOf(block.startHour) + block.duration] || '00:00';
            html += `
                <li class="member-list-item free-member" style="flex-direction: column; align-items: flex-start; gap: 0.4rem; padding: 0.8rem 1rem; border-left: 3px solid var(--color-success);">
                    <div style="display: flex; width: 100%; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                        <strong style="color: var(--text-primary);">#${index + 1}. ${getRoomDayLabel(block.day)} · ${block.startHour}–${endHour}</strong>
                        <div style="display: flex; align-items: center; gap: 0.4rem;">
                            <span class="block-duration-tag">${block.duration}h liên tiếp</span>
                            <span class="suggestion-tier-badge tier-badge-${tier}">${pct}%</span>
                        </div>
                    </div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">
                        <strong>Rảnh:</strong> ${block.freeNames.join(', ')} (${block.avgFree}/${membersToConsider.length} người)
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
                <li class="member-list-item free-member" style="flex-direction: column; align-items: flex-start; gap: 0.35rem; padding: 0.75rem 1rem; border-left: 3px solid var(--color-success);">
                    <div style="display: flex; width: 100%; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                        <strong style="color: var(--text-primary);">#${index + 1}. ${getRoomDayLabel(slot.day)} · ${slot.hour}–${getNextHourString(slot.hour)}</strong>
                        <span class="suggestion-tier-badge tier-badge-${tier}">${slot.freeCount}/${slot.total} (${pct}%)</span>
                    </div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">
                        <strong>Rảnh:</strong> ${slot.freeNames.join(', ')}
                    </div>
                    <div class="suggestion-progress-wrap">
                        <div class="suggestion-progress-bar tier-${tier}" style="width: ${pct}%"></div>
                    </div>
                </li>
            `;
        });
    }
    html += `</ul>`;

    // Thành viên linh hoạt nhất
    if (mostFlexibleMember && mostFlexibleMember.count > 0) {
        html += `<h3 class="detail-title">Thành viên linh hoạt nhất</h3>`;
        html += `
            <div class="member-list-item" style="padding: 0.75rem 1rem; margin-bottom: 0.75rem; border-left: 3px solid #06b6d4; gap: 0.5rem;">
                <span><strong>${mostFlexibleMember.name}</strong></span>
                <span style="color: var(--text-secondary); font-size: 0.8rem;">Rảnh ${mostFlexibleMember.count} khung giờ</span>
            </div>
        `;
    }

    // Thành viên khó xếp nhất (nếu khác người trên)
    if (leastFlexible && leastFlexible.name !== mostFlexibleMember?.name) {
        html += `<h3 class="detail-title">Thành viên ít rảnh nhất</h3>`;
        html += `
            <div class="member-list-item" style="padding: 0.75rem 1rem; margin-bottom: 1rem; border-left: 3px solid #f43f5e; gap: 0.5rem;">
                <span><strong>${leastFlexible.name}</strong></span>
                <span style="color: var(--text-secondary); font-size: 0.8rem;">Chỉ rảnh ${leastFlexible.count} khung giờ</span>
            </div>
        `;
    }

    html += `
        <button type="button" id="btn-copy-report" class="btn btn-primary btn-block">
            <i class="fa-solid fa-copy"></i> Sao chép báo cáo tóm tắt
        </button>
    `;
    html += `</div>`;
    suggestionsContent.innerHTML = html;

    // Attach copy report
    const btnCopyReport = document.getElementById('btn-copy-report');
    if (btnCopyReport) {
        btnCopyReport.addEventListener('click', () => {
            let reportText = `📊 BÁO CÁO LỊCH RẢNH TỔNG HỢP - ${state.room.name.toUpperCase()}\n`;
            reportText += `--------------------------------------------------\n`;
            reportText += `Top khung giờ họp tối ưu nhất:\n\n`;

            if (topBlocks.length > 0) {
                topBlocks.forEach((block, index) => {
                    const pct = Math.round((block.avgFree / membersToConsider.length) * 100);
                    const endHour = HOURS[HOURS.indexOf(block.startHour) + block.duration] || '00:00';
                    reportText += `${index + 1}. ${getRoomDayLabel(block.day)} từ ${block.startHour} đến ${endHour} (${block.duration}h liên tiếp)\n`;
                    reportText += `   👉 Trung bình: ${block.avgFree.toFixed(1)}/${membersToConsider.length} (${pct}%)\n`;
                    reportText += `   👉 Thành viên rảnh: ${block.freeNames}\n\n`;
                });
            } else {
                topSlots.forEach((slot, index) => {
                    const pct = Math.round((slot.freeCount / slot.total) * 100);
                    reportText += `${index + 1}. ${getRoomDayLabel(slot.day)} từ ${slot.hour} đến ${getNextHourString(slot.hour)}\n`;
                    reportText += `   👉 Số người rảnh: ${slot.freeCount}/${slot.total} (${pct}%)\n`;
                    reportText += `   👉 Thành viên rảnh: ${slot.freeNames.join(', ')}\n\n`;
                });
            }
            if (mostFlexibleMember && mostFlexibleMember.count > 0) {
                reportText += `👤 Thành viên rảnh nhiều nhất: ${mostFlexibleMember.name} (${mostFlexibleMember.count} khung giờ)\n`;
            }
            reportText += `--------------------------------------------------\n`;
            reportText += `TeamSync - Lập lịch trực tuyến của bạn!`;

            navigator.clipboard.writeText(reportText).then(() => {
                showToast("Đã sao chép báo cáo lịch biểu vào bộ nhớ tạm!");
            }).catch(() => showToast("Lỗi sao chép báo cáo.", "error"));
        });
    }
}

// Tìm các block giờ liên tiếp đủ dài (>= minDur) mà mỗi ô có >= 1 người rảnh
function findConsecutiveBlocks(members, activeDays, activeHours, minDur) {
    const blocks = [];
    activeDays.forEach(day => {
        for (let i = 0; i <= activeHours.length - minDur; i++) {
            // Check if minDur slots starting at i are consecutive
            let isConsecutive = true;
            for (let k = 0; k < minDur - 1; k++) {
                if (HOURS.indexOf(activeHours[i + k + 1]) !== HOURS.indexOf(activeHours[i + k]) + 1) {
                    isConsecutive = false;
                    break;
                }
            }
            if (!isConsecutive) continue;
            
            // Find intersection of free members across these minDur slots
            let freeMembers = members.filter(m => {
                for (let k = 0; k < minDur; k++) {
                    if (!m.schedule[day] || !m.schedule[day].includes(activeHours[i + k])) return false;
                }
                return true;
            });
            
            if (freeMembers.length > 0) {
                blocks.push({
                    day,
                    startHour: activeHours[i],
                    duration: minDur,
                    avgFree: freeMembers.length,
                    freeNames: freeMembers.map(m => m.name)
                });
            }
        }
    });
    
    // Remove duplicate blocks if they have the exact same members and overlap
    // But since they are all exactly length minDur, it's fine to just return them.
    return blocks;
}

// Mở khóa giao diện Admin
function unlockAdminView() {
    state.isAdminUnlocked = true;
    
    // Lưu vào Session để không phải nhập lại mật khẩu trong phiên làm việc hiện tại
    sessionStorage.setItem(`teamsync_unlocked_${state.currentRoomId}`, 'true');
    
    document.getElementById('admin-lock-card').classList.add('hidden');
    document.getElementById('admin-workspace-content').classList.remove('hidden');
    
    renderAdminGrid();
    updateAdminDetails();
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
            
            const btnOpenFilter = document.getElementById('btn-open-filter-modal');
            
            if (tabId === 'admin-tab') {
                if (btnOpenFilter) btnOpenFilter.classList.remove('hidden');
                const isUnlocked = sessionStorage.getItem(`teamsync_unlocked_${state.currentRoomId}`) === 'true';
                if (isUnlocked || state.isAdminUnlocked) {
                    unlockAdminView();
                } else {
                    document.getElementById('admin-lock-card').classList.remove('hidden');
                    document.getElementById('admin-workspace-content').classList.add('hidden');
                }
            } else {
                if (btnOpenFilter) btnOpenFilter.classList.add('hidden');
            }
        });
    });
    
    // Modal Filter Logic
    const btnOpenFilter = document.getElementById('btn-open-filter-modal');
    const filterModal = document.getElementById('admin-filter-modal');
    const btnCloseFilter = document.getElementById('btn-close-filter-modal');
    const btnApplyFilters = document.getElementById('btn-apply-filters');
    
    if (btnOpenFilter && filterModal && btnCloseFilter && btnApplyFilters) {
        btnOpenFilter.addEventListener('click', () => {
            filterModal.classList.remove('hidden');
        });
        
        const closeFilterModal = () => {
            filterModal.classList.add('hidden');
        };
        
        btnCloseFilter.addEventListener('click', closeFilterModal);
        btnApplyFilters.addEventListener('click', closeFilterModal);
        
        filterModal.addEventListener('click', (e) => {
            if (e.target === filterModal) closeFilterModal();
        });
    }
    
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
        });
    }
    if (btnClearAll) {
        btnClearAll.addEventListener('click', () => {
            if (!state.currentMemberId) return;
            document.querySelectorAll('#member-schedule-grid .grid-slot-cell').forEach(cell => {
                cell.classList.remove('state-free');
            });
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
    
    // Collapsible logic removed, now using Modal (see setupGlobalEventListeners)
    
    // 10. Tab Admin: Bộ lọc multi-select
    const btnResetFilters = document.getElementById('btn-reset-filters');
    
    // Setup member checkbox events (sẽ được gọi lại sau khi có thành viên)
    setupAdminMemberCheckboxEvents();
    
    // Day checkboxes
    setupDayCheckboxEvents();
    
    // Hour checkboxes
    setupHourCheckboxEvents();
    
    // Setup quick hour filter session buttons
    const morningBtn = document.getElementById('btn-filter-morning');
    const afternoonBtn = document.getElementById('btn-filter-afternoon');
    const eveningBtn = document.getElementById('btn-filter-evening');
    
    function filterHoursBySession(session) {
        const morningHours = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00'];
        const afternoonHours = ['12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];
        const eveningHours = ['18:00', '19:00', '20:00', '21:00', '22:00', '23:00'];
        
        let targetHours = [];
        if (session === 'morning') targetHours = morningHours;
        else if (session === 'afternoon') targetHours = afternoonHours;
        else if (session === 'evening') targetHours = eveningHours;
        
        const allHourCb = document.getElementById('admin-filter-hour-all');
        if (allHourCb) allHourCb.checked = false;
        
        const hourCbs = document.querySelectorAll('.admin-hour-check');
        hourCbs.forEach(cb => {
            const isMatch = targetHours.includes(cb.value);
            cb.checked = isMatch;
            const label = cb.closest('.check-item-label');
            if (isMatch) {
                label?.classList.add('is-selected');
            } else {
                label?.classList.remove('is-selected');
            }
        });
        
        state.adminFilters.hours = targetHours;
        renderAdminGrid();
        updateAdminDetails();
    }
    
    if (morningBtn) morningBtn.addEventListener('click', () => filterHoursBySession('morning'));
    if (afternoonBtn) afternoonBtn.addEventListener('click', () => filterHoursBySession('afternoon'));
    if (eveningBtn) eveningBtn.addEventListener('click', () => filterHoursBySession('evening'));
    
    // Setup min availability range slider listener
    const sliderMinFree = document.getElementById('admin-filter-min-free');
    const labelMinFreeVal = document.getElementById('admin-filter-min-free-val');
    
    if (sliderMinFree && labelMinFreeVal) {
        sliderMinFree.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            state.adminFilters.minFree = val;
            if (val === 0) {
                labelMinFreeVal.textContent = "Tất cả";
            } else {
                labelMinFreeVal.textContent = `>= ${val} người`;
            }
            renderAdminGrid();
            updateAdminDetails();
        });
    }

    // Duration buttons
    document.querySelectorAll('.btn-duration').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.btn-duration').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.adminFilters.minDuration = parseInt(btn.getAttribute('data-dur')) || 1;
            renderAdminGrid();
            updateAdminDetails();
        });
    });

    // Time range selects
    const timeStartSel = document.getElementById('filter-time-start');
    const timeEndSel = document.getElementById('filter-time-end');
    function applyTimeRange() {
        const startVal = timeStartSel ? timeStartSel.value : '';
        const endVal = timeEndSel ? timeEndSel.value : '';
        if (!startVal && !endVal) {
            state.adminFilters.hours = [];
        } else {
            const startIdx = startVal ? HOURS.indexOf(startVal) : 0;
            const endIdx = endVal ? HOURS.indexOf(endVal) : HOURS.length - 1;
            if (startIdx !== -1 && endIdx !== -1 && startIdx <= endIdx) {
                state.adminFilters.hours = HOURS.slice(startIdx, endIdx + 1);
                // Sync hour checkboxes
                const allHourCb = document.getElementById('admin-filter-hour-all');
                if (allHourCb) allHourCb.checked = false;
                document.querySelectorAll('.admin-hour-check').forEach(cb => {
                    const inRange = state.adminFilters.hours.includes(cb.value);
                    cb.checked = inRange;
                    cb.closest('.check-item-label')?.classList.toggle('is-selected', inRange);
                });
            }
        }
        renderAdminGrid();
        updateAdminDetails();
    }
    if (timeStartSel) timeStartSel.addEventListener('change', applyTimeRange);
    if (timeEndSel) timeEndSel.addEventListener('change', applyTimeRange);

    // Weekday / Weekend quick filter
    const btnWeekdays = document.getElementById('btn-filter-weekdays');
    const btnWeekends = document.getElementById('btn-filter-weekends');
    const WEEKDAY_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const WEEKEND_DAYS = ['Saturday', 'Sunday'];

    function filterByDayGroup(targetDays) {
        const activeDays = getRoomDays();
        const matchDays = targetDays.filter(d => activeDays.includes(d));
        const allDayCb = document.getElementById('admin-filter-day-all');
        if (allDayCb) allDayCb.checked = false;
        document.querySelectorAll('.admin-day-check').forEach(cb => {
            const isMatch = matchDays.includes(cb.value);
            cb.checked = isMatch;
            cb.closest('.check-item-label')?.classList.toggle('is-selected', isMatch);
        });
        state.adminFilters.days = matchDays;
        renderAdminGrid();
        updateAdminDetails();
    }
    if (btnWeekdays) btnWeekdays.addEventListener('click', () => filterByDayGroup(WEEKDAY_DAYS));
    if (btnWeekends) btnWeekends.addEventListener('click', () => filterByDayGroup(WEEKEND_DAYS));

    // Filter Presets
    document.querySelectorAll('.btn-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.getAttribute('data-preset');
            applyPreset(preset);
        });
    });
    if (btnResetFilters) {
        btnResetFilters.addEventListener('click', () => {
            state.adminFilters.memberIds = [];
            state.adminFilters.mandatoryMemberIds = [];
            state.adminFilters.days = [];
            state.adminFilters.hours = [];
            state.adminFilters.minFree = 0;
            state.adminFilters.minDuration = 1;
            state.adminFilters.timeRangeStart = null;
            state.adminFilters.timeRangeEnd = null;
            state.adminFilters.activePreset = null;
            state.selectedAdminCells = [];
            
            // Reset member checkboxes
            const memberAllCb = document.getElementById('admin-filter-member-all');
            if (memberAllCb) memberAllCb.checked = true;
            document.querySelectorAll('.admin-member-check').forEach(cb => {
                cb.checked = false;
                cb.closest('.check-item-label')?.classList.remove('is-selected');
            });
            
            // Reset star buttons
            document.querySelectorAll('.btn-toggle-mandatory').forEach(btn => {
                btn.classList.remove('is-active');
                const starIcon = btn.querySelector('.star-icon');
                if (starIcon) starIcon.className = 'fa-regular fa-star star-icon';
            });
            document.querySelectorAll('.check-item-label').forEach(lbl => {
                lbl.classList.remove('has-mandatory');
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
            
            // Reset slider
            const sliderMinFreeElement = document.getElementById('admin-filter-min-free');
            if (sliderMinFreeElement) sliderMinFreeElement.value = 0;
            const labelMinFreeValElement = document.getElementById('admin-filter-min-free-val');
            if (labelMinFreeValElement) labelMinFreeValElement.textContent = "Tất cả";

            // Reset duration buttons
            document.querySelectorAll('.btn-duration').forEach(b => b.classList.remove('active'));
            const dur1 = document.getElementById('dur-1h');
            if (dur1) dur1.classList.add('active');

            // Reset time range selects
            const tStart = document.getElementById('filter-time-start');
            const tEnd = document.getElementById('filter-time-end');
            if (tStart) tStart.value = '';
            if (tEnd) tEnd.value = '';

            // Reset preset buttons
            document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
            
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
        dragMode = null;
        isAdminDragging = false;
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

// Điền danh sách giờ cho 2 select Time Range (Từ giờ / Đến giờ)
function populateTimeRangeSelects() {
    const startSel = document.getElementById('filter-time-start');
    const endSel = document.getElementById('filter-time-end');
    if (!startSel || !endSel) return;

    const emptyOpt = () => {
        const o = document.createElement('option');
        o.value = '';
        o.textContent = '-- Tất cả --';
        return o;
    };

    startSel.innerHTML = '';
    endSel.innerHTML = '';
    startSel.appendChild(emptyOpt());
    endSel.appendChild(emptyOpt());

    HOURS.forEach(hour => {
        const nextH = getNextHourString(hour);
        const o1 = document.createElement('option');
        o1.value = hour;
        o1.textContent = `${hour}`;
        startSel.appendChild(o1);

        const o2 = document.createElement('option');
        o2.value = hour;
        o2.textContent = `${nextH}`;
        endSel.appendChild(o2);
    });
}

// Áp dụng preset bộ lọc nhanh
function applyPreset(presetName) {
    // Toggle: click lại preset đang active thì reset
    if (state.adminFilters.activePreset === presetName) {
        state.adminFilters.activePreset = null;
        state.adminFilters.days = [];
        state.adminFilters.hours = [];
        document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
        syncCheckboxesToFilters();
        renderAdminGrid();
        updateAdminDetails();
        return;
    }

    state.adminFilters.activePreset = presetName;
    document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
    document.querySelector(`.btn-preset[data-preset="${presetName}"]`)?.classList.add('active');

    const activeDays = getRoomDays();
    const WEEKDAY_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const WEEKEND_DAYS = ['Saturday', 'Sunday'];

    const WORKHOURS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'];
    const EVENING_HOURS = ['18:00', '19:00', '20:00', '21:00', '22:00', '23:00'];
    const MORNING_HOURS = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00'];

    switch (presetName) {
        case 'workhours':
            state.adminFilters.days = WEEKDAY_DAYS.filter(d => activeDays.includes(d));
            state.adminFilters.hours = WORKHOURS;
            break;
        case 'evening':
            state.adminFilters.days = [];
            state.adminFilters.hours = EVENING_HOURS;
            break;
        case 'weekend':
            state.adminFilters.days = WEEKEND_DAYS.filter(d => activeDays.includes(d));
            state.adminFilters.hours = [];
            break;
        case 'morning':
            state.adminFilters.days = [];
            state.adminFilters.hours = MORNING_HOURS;
            break;
    }

    syncCheckboxesToFilters();
    renderAdminGrid();
    updateAdminDetails();
}

// Đồng bộ trạng thái checkbox với state.adminFilters (sau khi áp dụng preset)
function syncCheckboxesToFilters() {
    const fDays = state.adminFilters.days;
    const fHours = state.adminFilters.hours;

    // Sync days
    const dayAllCb = document.getElementById('admin-filter-day-all');
    if (dayAllCb) dayAllCb.checked = fDays.length === 0;
    document.querySelectorAll('.admin-day-check').forEach(cb => {
        const isMatch = fDays.includes(cb.value);
        cb.checked = isMatch;
        cb.closest('.check-item-label')?.classList.toggle('is-selected', isMatch);
    });

    // Sync hours
    const hourAllCb = document.getElementById('admin-filter-hour-all');
    if (hourAllCb) hourAllCb.checked = fHours.length === 0;
    document.querySelectorAll('.admin-hour-check').forEach(cb => {
        const isMatch = fHours.includes(cb.value);
        cb.checked = isMatch;
        cb.closest('.check-item-label')?.classList.toggle('is-selected', isMatch);
    });

    // Sync time range selects
    const tStart = document.getElementById('filter-time-start');
    const tEnd = document.getElementById('filter-time-end');
    if (tStart) tStart.value = fHours.length > 0 ? fHours[0] : '';
    if (tEnd) tEnd.value = fHours.length > 0 ? fHours[fHours.length - 1] : '';
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
