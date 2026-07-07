import sys

with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# 1. Insert button into header
headerRight = '<div class="header-right">'
filterBtn = '\n                <button type="button" class="btn btn-primary hidden" id="btn-open-filter-modal" style="margin-right: 12px;">\n                    <i class="fa-solid fa-filter"></i> Lọc\n                </button>'
html = html.replace(headerRight, headerRight + filterBtn)

# 2. Extract filter body
startMarker = '<div class="card-body collapsible-body hidden" id="admin-filter-body">'
endMarker = '</div>\n                    </div>\n\n                        <!-- Selected Info Card (Moved above grid) -->'

startIndex = html.find(startMarker)
endIndex = html.find(endMarker)

if startIndex > -1 and endIndex > -1:
    filterBodyHtml = html[startIndex:endIndex]
    
    # Clean up the filter body class
    cleanFilterBody = filterBodyHtml.replace('class="card-body collapsible-body hidden"', 'class="modal-body"')
    
    # Remove the entire filter container from the DOM
    containerStart = '<div class="card admin-filter-card collapsible-card" id="admin-filter-container">'
    containerStartIndex = html.find(containerStart)
    html = html[:containerStartIndex] + html[endIndex + len('</div>\n                    </div>\n\n'):]
    
    # 3. Append modal to body
    modalHtml = f'''
    <!-- Admin Filter Modal -->
    <div class="modal-overlay hidden" id="admin-filter-modal">
        <div class="modal-content admin-filter-modal-content" style="max-width: 600px; width: 90%; max-height: 90vh; overflow-y: auto;">
            <div class="modal-header">
                <h2><i class="fa-solid fa-sliders"></i> CÔNG CỤ LỌC KẾT QUẢ</h2>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-close-filter-modal"><i class="fa-solid fa-xmark"></i></button>
            </div>
            {cleanFilterBody}
            <div class="modal-footer">
                <button type="button" id="btn-apply-filters" class="btn btn-primary btn-block">Áp dụng & Đóng</button>
            </div>
        </div>
    </div>
    '''
    
    html = html.replace('<!-- Core App Logic -->', modalHtml + '\n    <!-- Core App Logic -->')
    
    with open('index.html', 'w', encoding='utf-8') as f:
        f.write(html)
    print('Successfully modified index.html')
else:
    print('Could not find markers')
