// 族谱应用核心逻辑
class FamilyTree {
    constructor() {
        this.storageKeys = {
            data: 'familyTreeDataDraft',
            intro: 'familyIntroDraft',
            settings: 'familySiteSettingsDraft',
            legacyData: 'familyTreeData',
            legacyIntro: 'familyIntro'
        };
        this.isLocalOrigin = this.detectLocalOrigin();
        this.isEditMode = this.detectEditMode();
        this.siteSettings = this.loadSiteSettings();
        this.familyData = this.loadData();
        this.currentPersonId = null;
        this.currentParentId = null;
        this.currentPhoto = null;
        this.zoomLevel = 1;
        this.searchTerm = '';
        this.activeBranchRootId = '';
        this.activeGenerationFilter = '';
        this.branchHistory = [];
        this.showSpouses = true;
        this.init();
    }

    detectLocalOrigin() {
        const { protocol, hostname } = window.location;
        return protocol === 'file:' ||
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '::1' ||
            hostname === '[::1]' ||
            hostname.endsWith('.localhost');
    }

    detectEditMode() {
        const params = new URLSearchParams(window.location.search);
        if (params.get('readonly') === '1' || params.get('view') === 'public') return false;
        return this.isLocalOrigin;
    }

    applyMode() {
        document.body.classList.toggle('edit-mode', this.isEditMode);
        document.body.classList.toggle('view-mode', !this.isEditMode);

        const editorPanel = document.getElementById('editorPanel');
        if (editorPanel) editorPanel.hidden = !this.isEditMode;

        if (!this.isEditMode) {
            const introActions = document.getElementById('introActions');
            if (introActions) introActions.style.display = 'none';
        }
    }

    ensureEditMode() {
        if (this.isEditMode) return true;
        alert('公开页面为只读模式。请在本地打开或通过 localhost 访问后再编辑。');
        return false;
    }

    escapeHTML(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[char]));
    }

    escapeAttribute(value) {
        return this.escapeHTML(value).replace(/`/g, '&#096;');
    }

    getDefaultSiteSettings() {
        return {
            familyName: '家族',
            siteTitle: '家族族谱',
            siteSubtitle: '传承家族记忆，铭记血脉相连',
            footerText: '家族族谱 - 传承家族历史',
            accessPassword: ''
        };
    }

    loadSiteSettings() {
        const defaults = this.getDefaultSiteSettings();
        const staticSettings = typeof FAMILY_SITE_SETTINGS !== 'undefined' && FAMILY_SITE_SETTINGS
            ? FAMILY_SITE_SETTINGS
            : {};

        if (!this.isEditMode) return { ...defaults, ...staticSettings };

        const draft = localStorage.getItem(this.storageKeys.settings);
        if (draft) {
            try {
                return { ...defaults, ...staticSettings, ...JSON.parse(draft) };
            } catch (error) {
                console.warn('本地站点设置草稿读取失败，已回退到 data.js。', error);
            }
        }

        return { ...defaults, ...staticSettings };
    }

    saveSiteSettingsDraft() {
        if (!this.isEditMode) return;
        localStorage.setItem(this.storageKeys.settings, JSON.stringify(this.siteSettings));
    }

    applySiteSettings() {
        const settings = this.siteSettings;
        document.title = settings.siteTitle || '家族族谱';

        const siteTitle = document.getElementById('siteTitle');
        const siteSubtitle = document.getElementById('siteSubtitle');
        const siteFooter = document.getElementById('siteFooter');

        if (siteTitle) siteTitle.textContent = settings.siteTitle || '家族族谱';
        if (siteSubtitle) siteSubtitle.textContent = settings.siteSubtitle || '';
        if (siteFooter) siteFooter.textContent = settings.footerText || '';

        this.fillSiteSettingsForm();
    }

    fillSiteSettingsForm() {
        const map = {
            familyNameInput: this.siteSettings.familyName,
            siteTitleInput: this.siteSettings.siteTitle,
            siteSubtitleInput: this.siteSettings.siteSubtitle,
            footerTextInput: this.siteSettings.footerText,
            accessPasswordInput: this.siteSettings.accessPassword
        };

        Object.entries(map).forEach(([id, value]) => {
            const input = document.getElementById(id);
            if (input) input.value = value || '';
        });
    }

    initPasswordGate() {
        const gate = document.getElementById('passwordGate');
        const form = document.getElementById('passwordForm');
        const input = document.getElementById('passwordInput');
        const error = document.getElementById('passwordError');
        const password = this.siteSettings.accessPassword || '';

        if (!gate || !form || this.isEditMode || !password) {
            if (gate) gate.hidden = true;
            document.body.classList.remove('locked');
            return;
        }

        const unlockKey = `familyTreeUnlocked:${this.siteSettings.siteTitle || 'site'}`;
        if (sessionStorage.getItem(unlockKey) === '1') {
            gate.hidden = true;
            document.body.classList.remove('locked');
            return;
        }

        document.body.classList.add('locked');
        gate.hidden = false;
        setTimeout(() => input?.focus(), 50);

        form.addEventListener('submit', (event) => {
            event.preventDefault();
            if (input.value === password) {
                sessionStorage.setItem(unlockKey, '1');
                gate.hidden = true;
                document.body.classList.remove('locked');
                error.hidden = true;
            } else {
                error.hidden = false;
                input.select();
            }
        });
    }

    // 初始化应用
    init() {
        this.applyMode();
        this.applySiteSettings();
        this.initPasswordGate();
        this.bindEvents();
        this.loadFamilyIntro();
        this.populateBranchControls();
        this.render();
        this.initDragScroll();
        requestAnimationFrame(() => this.homeView());
        window.addEventListener('resize', () => this.drawConnectors());
    }

    // 初始化拖动滚动
    initDragScroll() {
        const container = document.getElementById('treeContainer');
        if (!container) return;

        let dragState = null;
        let suppressNextClick = false;

        const getPoint = (event) => {
            const touch = event.touches?.[0] || event.changedTouches?.[0];
            return touch ? { x: touch.clientX, y: touch.clientY } : { x: event.clientX, y: event.clientY };
        };

        const canDragFrom = (target) => !target.closest('.context-menu, .btn, input, textarea, select, label');

        const startDrag = (event) => {
            if (!canDragFrom(event.target)) return;
            const point = getPoint(event);
            dragState = {
                startX: point.x,
                startY: point.y,
                scrollLeft: container.scrollLeft,
                scrollTop: container.scrollTop,
                moved: false
            };
            container.style.cursor = 'grabbing';
        };

        const moveDrag = (event) => {
            if (!dragState) return;
            const point = getPoint(event);
            const dx = point.x - dragState.startX;
            const dy = point.y - dragState.startY;

            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                dragState.moved = true;
                event.preventDefault();
                container.scrollLeft = dragState.scrollLeft - dx;
                container.scrollTop = dragState.scrollTop - dy;
            }
        };

        const stopDrag = () => {
            if (dragState?.moved) suppressNextClick = true;
            dragState = null;
            container.style.cursor = 'grab';
            setTimeout(() => { suppressNextClick = false; }, 120);
        };

        container.addEventListener('pointerdown', startDrag);
        window.addEventListener('pointermove', moveDrag, { passive: false });
        window.addEventListener('pointerup', stopDrag);
        window.addEventListener('pointercancel', stopDrag);

        container.addEventListener('touchstart', startDrag, { passive: true });
        window.addEventListener('touchmove', moveDrag, { passive: false });
        window.addEventListener('touchend', stopDrag);
        window.addEventListener('touchcancel', stopDrag);

        container.addEventListener('click', (event) => {
            const card = event.target.closest('.member-card:not(.spouse-card)');
            if (suppressNextClick) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (card) {
                const member = card.closest('.family-member');
                const personId = member?.dataset.id;
                if (personId) this.showContextMenu(personId, event);
            }
        });

        container.style.cursor = 'grab';
    }

    // 绑定事件
    bindEvents() {
        // 标签页切换
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });

        // 添加始祖
        const addRootBtn = document.getElementById('addRootBtn');
        if (addRootBtn) addRootBtn.addEventListener('click', () => {
            if (this.ensureEditMode()) this.openAddModal(null);
        });

        // 加载示例
        const loadSampleBtn = document.getElementById('loadSampleBtn');
        if (loadSampleBtn) loadSampleBtn.addEventListener('click', () => {
            if (this.ensureEditMode()) this.loadSampleData();
        });

        const exportDataBtn = document.getElementById('exportDataBtn');
        const resetDraftBtn = document.getElementById('resetDraftBtn');
        const toggleSiteSettingsBtn = document.getElementById('toggleSiteSettingsBtn');
        const saveSiteSettingsBtn = document.getElementById('saveSiteSettingsBtn');
        const cancelSiteSettingsBtn = document.getElementById('cancelSiteSettingsBtn');
        if (exportDataBtn) exportDataBtn.addEventListener('click', () => this.exportDataFile());
        if (resetDraftBtn) resetDraftBtn.addEventListener('click', () => this.resetLocalDraft());
        if (toggleSiteSettingsBtn) toggleSiteSettingsBtn.addEventListener('click', () => this.toggleSiteSettings());
        if (saveSiteSettingsBtn) saveSiteSettingsBtn.addEventListener('click', () => this.saveSiteSettings());
        if (cancelSiteSettingsBtn) cancelSiteSettingsBtn.addEventListener('click', () => this.toggleSiteSettings(false));

        // 照片上传
        const photoInput = document.getElementById('photo');
        if (photoInput) photoInput.addEventListener('change', (e) => this.handlePhotoUpload(e));

        // 缩放
        const zoomInBtn = document.getElementById('zoomInBtn');
        const zoomOutBtn = document.getElementById('zoomOutBtn');
        const resetViewBtn = document.getElementById('resetViewBtn');
        const homeViewBtn = document.getElementById('homeViewBtn');
        const toggleSpouseBtn = document.getElementById('toggleSpouseBtn');
        if (zoomInBtn) zoomInBtn.addEventListener('click', () => this.zoom(1.1));
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this.zoom(0.9));
        if (resetViewBtn) resetViewBtn.addEventListener('click', () => this.resetView());
        if (homeViewBtn) homeViewBtn.addEventListener('click', () => this.homeView());
        if (toggleSpouseBtn) toggleSpouseBtn.addEventListener('click', () => this.toggleSpouses());

        const generationFilter = document.getElementById('generationFilter');
        const branchFilter = document.getElementById('branchFilter');
        const focusBranchBtn = document.getElementById('focusBranchBtn');
        const backBranchBtn = document.getElementById('backBranchBtn');
        const showAllBtn = document.getElementById('showAllBtn');
        if (generationFilter) generationFilter.addEventListener('change', () => this.updateBranchOptions());
        if (branchFilter) branchFilter.addEventListener('change', () => {
            this.activeBranchRootId = branchFilter.value;
        });
        if (focusBranchBtn) focusBranchBtn.addEventListener('click', () => this.focusSelectedBranch());
        if (backBranchBtn) backBranchBtn.addEventListener('click', () => this.backBranch());
        if (showAllBtn) showAllBtn.addEventListener('click', () => this.showAllBranches());

        // 搜索
        const searchInput = document.getElementById('searchInput');
        const searchBtn = document.getElementById('searchBtn');
        const clearSearchBtn = document.getElementById('clearSearchBtn');
        if (searchInput) {
            searchInput.addEventListener('keyup', (e) => {
                if (e.key === 'Enter') this.search();
            });
        }
        if (searchBtn) searchBtn.addEventListener('click', () => this.search());
        if (clearSearchBtn) clearSearchBtn.addEventListener('click', () => this.clearSearch());

        // 模态框
        const closeModal = document.getElementById('closeModal');
        const cancelBtn = document.getElementById('cancelBtn');
        const closeDetailModal = document.getElementById('closeDetailModal');
        if (closeModal) closeModal.addEventListener('click', () => this.closeModal());
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeModal());
        if (closeDetailModal) closeDetailModal.addEventListener('click', () => this.closeDetailModal());

        // 表单提交
        const personForm = document.getElementById('personForm');
        if (personForm) {
            personForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.savePerson();
            });
        }

        // 详情操作
        const editPersonBtn = document.getElementById('editPersonBtn');
        const addChildBtn = document.getElementById('addChildBtn');
        const deletePersonBtn = document.getElementById('deletePersonBtn');
        if (editPersonBtn) editPersonBtn.addEventListener('click', () => {
            if (this.ensureEditMode()) this.editCurrentPerson();
        });
        if (addChildBtn) addChildBtn.addEventListener('click', () => {
            if (this.ensureEditMode()) this.addChildToCurrent();
        });
        if (deletePersonBtn) deletePersonBtn.addEventListener('click', () => {
            if (this.ensureEditMode()) this.deleteCurrentPerson();
        });

        // 模态框外部点击关闭
        const personModal = document.getElementById('personModal');
        const detailModal = document.getElementById('detailModal');
        if (personModal) {
            personModal.addEventListener('click', (e) => {
                if (e.target === personModal) this.closeModal();
            });
        }
        if (detailModal) {
            detailModal.addEventListener('click', (e) => {
                if (e.target === detailModal) this.closeDetailModal();
            });
        }

        // 家族简介编辑
        const editIntroBtn = document.getElementById('editIntroBtn');
        const saveIntroBtn = document.getElementById('saveIntroBtn');
        const cancelIntroBtn = document.getElementById('cancelIntroBtn');
        if (editIntroBtn) editIntroBtn.addEventListener('click', () => {
            if (this.ensureEditMode()) this.startEditIntro();
        });
        if (saveIntroBtn) saveIntroBtn.addEventListener('click', () => {
            if (this.ensureEditMode()) this.saveFamilyIntro();
        });
        if (cancelIntroBtn) cancelIntroBtn.addEventListener('click', () => this.cancelEditIntro());

        // 点击其他地方关闭右键菜单
        document.addEventListener('mousedown', (e) => {
            if (!e.target.closest('.context-menu') && !e.target.closest('.member-card')) {
                this.closeContextMenu();
            }
        });
    }

    // 切换标签页
    switchTab(tabName) {
        // 更新按钮状态
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });
        
        // 更新页面显示
        document.querySelectorAll('.tab-page').forEach(page => {
            page.classList.remove('active');
        });
        document.getElementById(tabName === 'intro' ? 'introPage' : 'treePage').classList.add('active');
        
        // 如果切换到族谱页面，重新绘制连接线
        if (tabName === 'tree') {
            requestAnimationFrame(() => this.drawConnectors());
        }
    }

    // 搜索功能
    search() {
        const searchInput = document.getElementById('searchInput');
        const searchTerm = searchInput.value.trim();
        
        if (!searchTerm) {
            this.clearSearch();
            return;
        }

        this.searchTerm = searchTerm;
        const results = this.familyData.filter(p => 
            p.name.includes(searchTerm) || 
            (p.spouse && p.spouse.includes(searchTerm)) ||
            (p.notes && p.notes.includes(searchTerm))
        );

        this.render();
        this.showSearchResult(results, searchTerm);
    }

    // 显示搜索结果
    showSearchResult(results, searchTerm) {
        const resultDiv = document.getElementById('searchResult');
        const clearBtn = document.getElementById('clearSearchBtn');
        
        const safeSearchTerm = this.escapeHTML(searchTerm);
        if (results.length === 0) {
            resultDiv.innerHTML = `未找到包含 "<span class="highlight">${safeSearchTerm}</span>" 的成员`;
        } else {
            const names = results.map(p => `<span class="highlight">${this.escapeHTML(p.name)}</span>`).join('、');
            resultDiv.innerHTML = `找到 ${results.length} 位成员：${names}`;
            
            // 滚动到第一个匹配的成员
            setTimeout(() => {
                const firstMatch = document.querySelector(`.family-member[data-id="${results[0].id}"]`);
                if (firstMatch) {
                    firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    firstMatch.querySelector('.member-card').classList.add('highlight-card');
                }
            }, 100);
        }
        
        resultDiv.style.display = 'block';
        clearBtn.style.display = 'inline-flex';
    }

    // 清除搜索
    clearSearch() {
        this.searchTerm = '';
        document.getElementById('searchInput').value = '';
        document.getElementById('searchResult').style.display = 'none';
        document.getElementById('clearSearchBtn').style.display = 'none';
        document.querySelectorAll('.highlight-card').forEach(el => el.classList.remove('highlight-card'));
        this.render();
        this.updateBranchStatus();
    }

    populateBranchControls() {
        this.updateGenerationOptions();
        this.updateBranchOptions();
        this.updateBranchStatus();
        this.updateBranchBackButton();
    }

    updateGenerationOptions() {
        const select = document.getElementById('generationFilter');
        if (!select) return;
        const selected = select.value || this.activeGenerationFilter;
        const generations = [...new Set(this.familyData.map(p => p.generation).filter(Boolean))].sort((a, b) => a - b);

        select.innerHTML = '<option value="">全部世代</option>' +
            generations.map(g => `<option value="${this.escapeAttribute(g)}">第${this.escapeHTML(g)}世</option>`).join('');
        select.value = generations.includes(Number(selected)) ? selected : '';
        this.activeGenerationFilter = select.value;
    }

    updateBranchOptions() {
        const generationSelect = document.getElementById('generationFilter');
        const branchSelect = document.getElementById('branchFilter');
        if (!branchSelect) return;

        this.activeGenerationFilter = generationSelect?.value || '';
        const generation = this.activeGenerationFilter ? Number(this.activeGenerationFilter) : null;
        const people = this.familyData
            .filter(person => !generation || person.generation === generation)
            .sort((a, b) => (a.generation || 0) - (b.generation || 0) || String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));

        branchSelect.innerHTML = '<option value="">完整族谱</option>' +
            people.map(person => {
                const label = `第${person.generation || '?'}世 - ${this.escapeHTML(person.name)}`;
                return `<option value="${this.escapeAttribute(person.id)}">${label}</option>`;
            }).join('');

        if (!people.some(person => person.id === this.activeBranchRootId)) {
            this.activeBranchRootId = '';
        }
        branchSelect.value = this.activeBranchRootId;
    }

    focusSelectedBranch() {
        const branchSelect = document.getElementById('branchFilter');
        this.setBranchView(branchSelect?.value || '', { pushHistory: true });
    }

    focusBranch(personId) {
        const person = this.familyData.find(p => p.id === personId);
        if (!person) return;
        this.setBranchView(personId, {
            generation: person.generation ? String(person.generation) : '',
            pushHistory: true,
            closeDetail: true
        });
    }

    setBranchView(personId, options = {}) {
        const previous = {
            branchId: this.activeBranchRootId,
            generation: this.activeGenerationFilter
        };
        if (options.pushHistory && (previous.branchId !== personId || previous.generation !== (options.generation ?? this.activeGenerationFilter))) {
            this.branchHistory.push(previous);
        }

        this.activeBranchRootId = personId || '';
        if (options.generation !== undefined) this.activeGenerationFilter = options.generation || '';

        const generationSelect = document.getElementById('generationFilter');
        if (generationSelect) generationSelect.value = this.activeGenerationFilter;
        this.updateBranchOptions();
        const branchSelect = document.getElementById('branchFilter');
        if (branchSelect) branchSelect.value = this.activeBranchRootId;

        this.searchTerm = '';
        const searchInput = document.getElementById('searchInput');
        const searchResult = document.getElementById('searchResult');
        const clearSearchBtn = document.getElementById('clearSearchBtn');
        if (searchInput) searchInput.value = '';
        if (searchResult) searchResult.style.display = 'none';
        if (clearSearchBtn) clearSearchBtn.style.display = 'none';

        if (options.closeDetail) this.closeDetailModal();
        this.render();
        this.updateBranchStatus();
        this.updateBranchBackButton();
        requestAnimationFrame(() => this.centerTreeView());
    }

    showAllBranches() {
        this.setBranchView('', { generation: '', pushHistory: true });
    }

    backBranch() {
        const previous = this.branchHistory.pop();
        if (!previous) return;
        this.setBranchView(previous.branchId, {
            generation: previous.generation,
            pushHistory: false
        });
    }

    updateBranchStatus() {
        const status = document.getElementById('branchStatus');
        if (!status) return;
        if (!this.activeBranchRootId) {
            status.style.display = 'none';
            status.textContent = '';
            return;
        }

        const person = this.familyData.find(p => p.id === this.activeBranchRootId);
        if (!person) {
            status.style.display = 'none';
            status.textContent = '';
            return;
        }

        const count = this.getDescendantIds(person.id).size;
        status.innerHTML = `当前查看：<strong>${this.escapeHTML(person.name)}</strong> 这一支，共 ${count} 位成员`;
        status.style.display = 'block';
    }

    updateBranchBackButton() {
        const button = document.getElementById('backBranchBtn');
        if (!button) return;
        button.disabled = this.branchHistory.length === 0;
    }

    getDescendantIds(rootId) {
        const ids = new Set([rootId]);
        const walk = (personId) => {
            this.familyData.filter(person => person.parentId === personId).forEach(child => {
                ids.add(child.id);
                walk(child.id);
            });
        };
        walk(rootId);
        return ids;
    }

    centerTreeView() {
        this.homeView();
    }

    loadData() {
        const staticData = typeof FAMILY_TREE_DATA !== 'undefined' && Array.isArray(FAMILY_TREE_DATA) ? FAMILY_TREE_DATA : [];
        if (!this.isEditMode) return staticData.map(person => ({ ...person }));

        const draft = localStorage.getItem(this.storageKeys.data) || localStorage.getItem(this.storageKeys.legacyData);
        if (draft) {
            try {
                const parsed = JSON.parse(draft);
                if (Array.isArray(parsed)) return parsed;
            } catch (error) {
                console.warn('本地族谱草稿读取失败，已回退到 data.js。', error);
            }
        }

        return staticData.map(person => ({ ...person }));
    }

    saveData() {
        if (!this.isEditMode) return;
        localStorage.setItem(this.storageKeys.data, JSON.stringify(this.familyData));
    }

    toggleSiteSettings(force) {
        if (!this.ensureEditMode()) return;
        const panel = document.getElementById('siteSettingsPanel');
        if (!panel) return;
        const shouldShow = typeof force === 'boolean' ? force : panel.hidden;
        panel.hidden = !shouldShow;
        if (shouldShow) this.fillSiteSettingsForm();
    }

    saveSiteSettings() {
        if (!this.ensureEditMode()) return;
        const familyName = document.getElementById('familyNameInput')?.value.trim() || '家族';
        const siteTitle = document.getElementById('siteTitleInput')?.value.trim() || `${familyName}族谱`;
        const siteSubtitle = document.getElementById('siteSubtitleInput')?.value.trim() || '传承家族记忆，铭记血脉相连';
        const footerText = document.getElementById('footerTextInput')?.value.trim() || `${siteTitle} - 传承家族历史`;
        const accessPassword = document.getElementById('accessPasswordInput')?.value.trim() || '';

        this.siteSettings = { familyName, siteTitle, siteSubtitle, footerText, accessPassword };
        this.saveSiteSettingsDraft();
        this.applySiteSettings();
        this.render();
        alert('站点设置已保存。本地预览已更新，发布前请重新导出 data.js。');
    }

    getCurrentIntroText() {
        const introElement = document.getElementById('familyIntro');
        if (!introElement || introElement.classList.contains('intro-placeholder')) return '';
        return introElement.textContent.trim();
    }

    buildDataFileContent() {
        const introText = this.getCurrentIntroText();
        return `// 家族族谱 - 公开展示数据\n// 本文件由本地编辑模式导出，提交到 GitHub 后访客只能查看，不能在线修改。\nconst FAMILY_SITE_SETTINGS = ${JSON.stringify(this.siteSettings, null, 4)};\n\nconst FAMILY_TREE_DATA = ${JSON.stringify(this.familyData, null, 4)};\n\nconst FAMILY_INTRO_TEXT = ${JSON.stringify(introText)};\n`; 
    }

    exportDataFile() {
        if (!this.ensureEditMode()) return;
        const content = this.buildDataFileContent();
        const blob = new Blob([content], { type: 'text/javascript;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'data.js';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        alert('已导出 data.js。请用这个文件替换项目里的 data.js，然后提交并推送到 GitHub。');
    }

    resetLocalDraft() {
        if (!this.ensureEditMode()) return;
        if (!confirm('确定放弃本地草稿吗？这会清除本浏览器保存的编辑内容，并恢复到 data.js 中的公开版本。')) return;
        localStorage.removeItem(this.storageKeys.data);
        localStorage.removeItem(this.storageKeys.intro);
        localStorage.removeItem(this.storageKeys.settings);
        localStorage.removeItem(this.storageKeys.legacyData);
        localStorage.removeItem(this.storageKeys.legacyIntro);
        window.location.reload();
    }

    // 加载家族简介
    loadFamilyIntro() {
        const staticIntro = typeof FAMILY_INTRO_TEXT !== 'undefined' ? FAMILY_INTRO_TEXT : '';
        const draftIntro = this.isEditMode ? localStorage.getItem(this.storageKeys.intro) : null;
        const legacyIntro = this.isEditMode ? localStorage.getItem(this.storageKeys.legacyIntro) : null;
        const intro = this.isEditMode ? (draftIntro ?? legacyIntro ?? staticIntro) : staticIntro;
        const introElement = document.getElementById('familyIntro');
        if (introElement) {
            if (intro) {
                introElement.textContent = intro;
                introElement.classList.remove('intro-placeholder');
            } else {
                introElement.textContent = this.isEditMode ? '点击"编辑"按钮添加家族简介...' : '暂无家族简介。';
                introElement.classList.add('intro-placeholder');
            }
        }
    }

    // 开始编辑家族简介
    startEditIntro() {
        if (!this.ensureEditMode()) return;
        const introElement = document.getElementById('familyIntro');
        const editBtn = document.getElementById('editIntroBtn');
        const actions = document.getElementById('introActions');
        
        if (introElement) {
            if (introElement.classList.contains('intro-placeholder')) {
                introElement.textContent = '';
            }
            introElement.contentEditable = 'true';
            introElement.focus();
        }
        if (editBtn) editBtn.style.display = 'none';
        if (actions) actions.style.display = 'flex';
    }

    getIntroTextFromElement(element) {
        const clone = element.cloneNode(true);
        clone.querySelectorAll('br').forEach(br => br.replaceWith(document.createTextNode('\n')));
        clone.querySelectorAll('div').forEach(div => {
            if (div !== clone) div.insertAdjacentText('beforebegin', '\n');
        });
        return clone.textContent;
    }

    // 保存家族简介
    saveFamilyIntro() {
        if (!this.ensureEditMode()) return;
        const introElement = document.getElementById('familyIntro');
        const editBtn = document.getElementById('editIntroBtn');
        const actions = document.getElementById('introActions');
        
        if (introElement) {
            const text = this.getIntroTextFromElement(introElement).trim();
            if (text) {
                localStorage.setItem(this.storageKeys.intro, text);
                introElement.classList.remove('intro-placeholder');
            } else {
                localStorage.removeItem(this.storageKeys.intro);
                introElement.textContent = '点击"编辑"按钮添加家族简介...';
                introElement.classList.add('intro-placeholder');
            }
            introElement.contentEditable = 'false';
        }
        if (editBtn) editBtn.style.display = 'inline-flex';
        if (actions) actions.style.display = 'none';
    }

    // 取消编辑家族简介
    cancelEditIntro() {
        const introElement = document.getElementById('familyIntro');
        const editBtn = document.getElementById('editIntroBtn');
        const actions = document.getElementById('introActions');
        
        if (introElement) {
            introElement.contentEditable = 'false';
            this.loadFamilyIntro();
        }
        if (editBtn) editBtn.style.display = 'inline-flex';
        if (actions) actions.style.display = 'none';
    }

    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    calculateGeneration(parentId) {
        if (!parentId) return 1;
        const parent = this.familyData.find(p => p.id === parentId);
        return parent ? parent.generation + 1 : 1;
    }

    handlePhotoUpload(event) {
        if (!this.ensureEditMode()) {
            event.target.value = '';
            return;
        }
        const file = event.target.files[0];
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) {
            alert('照片大小不能超过 2MB');
            event.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const maxSize = 200;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxSize) { height *= maxSize / width; width = maxSize; }
                } else {
                    if (height > maxSize) { width *= maxSize / height; height = maxSize; }
                }

                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);

                this.currentPhoto = canvas.toDataURL('image/jpeg', 0.7);
                const preview = document.getElementById('photoPreview');
                if (preview) preview.innerHTML = `<img src="${this.currentPhoto}" alt="照片预览">`;
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    showContextMenu(personId, event) {
        if (event.defaultPrevented) return;
        event.stopPropagation();
        event.preventDefault();
        this.closeContextMenu();
        
        const person = this.familyData.find(p => p.id === personId);
        if (!person) return;
        if (!this.isEditMode) {
            this.openDetailModal(personId);
            return;
        }

        this.currentPersonId = personId;

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.innerHTML = `
            <div class="context-menu-item" data-action="detail"><span class="menu-icon">👁️</span><span>查看详情</span></div>
            <div class="context-menu-item" data-action="branch"><span class="menu-icon">🌿</span><span>查看此分支</span></div>
            <div class="context-menu-item" data-action="addChild"><span class="menu-icon">👶</span><span>添加子女</span></div>
            <div class="context-menu-item" data-action="edit"><span class="menu-icon">✏️</span><span>编辑</span></div>
            <div class="context-menu-item menu-danger" data-action="delete"><span class="menu-icon">🗑️</span><span>删除</span></div>
        `;

        menu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                this.handleMenuAction(item.getAttribute('data-action'), personId);
            });
        });

        menu.style.position = 'fixed';
        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;
        menu.style.zIndex = '1000';
        document.body.appendChild(menu);

        const menuRect = menu.getBoundingClientRect();
        if (menuRect.right > window.innerWidth) menu.style.left = `${window.innerWidth - menuRect.width - 10}px`;
        if (menuRect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - menuRect.height - 10}px`;
    }

    handleMenuAction(action, personId) {
        this.closeContextMenu();
        if (['addChild', 'edit', 'delete'].includes(action) && !this.ensureEditMode()) return;
        switch (action) {
            case 'detail': this.openDetailModal(personId); break;
            case 'branch': this.focusBranch(personId); break;
            case 'addChild': this.openAddModal(personId); break;
            case 'edit': this.openEditModal(personId); break;
            case 'delete': this.deletePerson(personId); break;
        }
    }

    closeContextMenu() {
        document.querySelectorAll('.context-menu').forEach(menu => menu.remove());
    }

    openAddModal(parentId) {
        if (!this.ensureEditMode()) return;
        this.currentPersonId = null;
        this.currentPhoto = null;
        this.currentParentId = parentId || null;
        
        document.getElementById('modalTitle').textContent = parentId ? '添加子女' : '添加始祖';
        document.getElementById('personForm').reset();
        document.getElementById('personId').value = '';
        document.getElementById('parentId').value = parentId || '';
        document.getElementById('generation').value = this.calculateGeneration(parentId);
        
        const preview = document.getElementById('photoPreview');
        if (preview) preview.innerHTML = '<span class="photo-placeholder">📷</span>';
        const photoInput = document.getElementById('photo');
        if (photoInput) photoInput.value = '';
        
        document.getElementById('personModal').classList.add('active');
    }

    openEditModal(personId) {
        if (!this.ensureEditMode()) return;
        const person = this.familyData.find(p => p.id === personId);
        if (!person) return;

        this.currentPersonId = personId;
        this.currentPhoto = person.photo || null;
        document.getElementById('modalTitle').textContent = '编辑成员';
        document.getElementById('personId').value = person.id;
        document.getElementById('parentId').value = person.parentId || '';
        document.getElementById('name').value = person.name;
        document.getElementById('gender').value = person.gender;
        document.getElementById('birthYear').value = person.birthYear || '';
        document.getElementById('deathYear').value = person.deathYear || '';
        document.getElementById('generation').value = person.generation;
        document.getElementById('spouse').value = person.spouse || '';
        document.getElementById('notes').value = person.notes || '';
        
        const preview = document.getElementById('photoPreview');
        if (preview) preview.innerHTML = person.photo ? `<img src="${person.photo}" alt="照片预览">` : '<span class="photo-placeholder">📷</span>';
        const photoInput = document.getElementById('photo');
        if (photoInput) photoInput.value = '';
        
        document.getElementById('personModal').classList.add('active');
    }

    closeModal() {
        document.getElementById('personModal').classList.remove('active');
        this.currentPersonId = null;
        this.currentParentId = null;
    }

    openDetailModal(personId) {
        this.closeContextMenu();
        const person = this.familyData.find(p => p.id === personId);
        if (!person) return;

        this.currentPersonId = personId;
        document.getElementById('detailTitle').textContent = person.name + ' 的详情';
        
        const content = document.getElementById('detailContent');
        const safeName = this.escapeHTML(person.name);
        const safePhoto = person.photo ? this.escapeAttribute(person.photo) : '';
        const safePhotoAlt = this.escapeAttribute(person.name);
        const safeBirthYear = this.escapeHTML(person.birthYear);
        const safeDeathYear = this.escapeHTML(person.deathYear);
        const safeGeneration = this.escapeHTML(person.generation);
        const safeSpouse = this.escapeHTML(person.spouse);
        const safeNotes = this.escapeHTML(person.notes);
        const photoHtml = safePhoto ? `<div class="detail-photo"><img src="${safePhoto}" alt="${safePhotoAlt}"></div>` : '';
        
        content.innerHTML = `
            ${photoHtml}
            <div class="detail-row"><span class="detail-label">姓名</span><span class="detail-value">${safeName}</span></div>
            <div class="detail-row"><span class="detail-label">性别</span><span class="detail-value">${person.gender === 'male' ? '男' : '女'}</span></div>
            ${person.birthYear ? `<div class="detail-row"><span class="detail-label">出生年份</span><span class="detail-value">${safeBirthYear}年</span></div>` : ''}
            ${person.deathYear ? `<div class="detail-row"><span class="detail-label">逝世年份</span><span class="detail-value">${safeDeathYear}年</span></div>` : ''}
            <div class="detail-row"><span class="detail-label">世代</span><span class="detail-value">第${safeGeneration}世</span></div>
            ${person.spouse ? `<div class="detail-row"><span class="detail-label">配偶</span><span class="detail-value">${safeSpouse}</span></div>` : ''}
            ${person.notes ? `<div class="detail-row"><span class="detail-label">备注</span><span class="detail-value">${safeNotes}</span></div>` : ''}
            <div class="detail-row"><span class="detail-label">子女数量</span><span class="detail-value">${this.familyData.filter(p => p.parentId === personId).length}人</span></div>
        `;
        
        document.getElementById('detailModal').classList.add('active');
    }

    closeDetailModal() {
        document.getElementById('detailModal').classList.remove('active');
        this.currentPersonId = null;
    }

    savePerson() {
        if (!this.ensureEditMode()) return;
        const personId = document.getElementById('personId').value;
        const parentId = document.getElementById('parentId').value || this.currentParentId || null;
        const name = document.getElementById('name').value.trim();
        const gender = document.getElementById('gender').value;
        const birthYear = document.getElementById('birthYear').value ? parseInt(document.getElementById('birthYear').value) : null;
        const deathYear = document.getElementById('deathYear').value ? parseInt(document.getElementById('deathYear').value) : null;
        const generation = parseInt(document.getElementById('generation').value) || 1;
        const spouse = document.getElementById('spouse').value.trim();
        const notes = document.getElementById('notes').value.trim();
        const photo = this.currentPhoto || null;

        if (!name) { alert('请输入姓名'); return; }

        if (personId) {
            const index = this.familyData.findIndex(p => p.id === personId);
            if (index !== -1) {
                this.familyData[index] = { ...this.familyData[index], name, gender, birthYear, deathYear, generation, spouse, notes, photo };
            }
        } else {
            this.familyData.push({
                id: this.generateId(), parentId, name, gender, birthYear, deathYear, generation, spouse, notes, photo,
                createdAt: new Date().toISOString()
            });
        }

        this.currentPhoto = null;
        this.currentParentId = null;
        this.saveData();
        this.populateBranchControls();
        this.closeModal();
        this.render();
    }

    deletePerson(personId) {
        if (!this.ensureEditMode()) return;
        this.closeContextMenu();
        const person = this.familyData.find(p => p.id === personId);
        if (!person) return;

        const children = this.familyData.filter(p => p.parentId === personId);
        if (children.length > 0) {
            if (!confirm(`确定要删除 ${person.name} 吗？\n\n注意：该成员有 ${children.length} 个子女，删除后子女将同时被删除。`)) return;
            this.deleteDescendants(personId);
        } else {
            if (!confirm(`确定要删除 ${person.name} 吗？`)) return;
        }

        this.familyData = this.familyData.filter(p => p.id !== personId);
        this.saveData();
        this.populateBranchControls();
        this.closeDetailModal();
        this.render();
    }

    deleteCurrentPerson() {
        const personId = this.currentPersonId;
        if (personId) this.deletePerson(personId);
    }

    deleteDescendants(personId) {
        const children = this.familyData.filter(p => p.parentId === personId);
        children.forEach(child => {
            this.deleteDescendants(child.id);
            this.familyData = this.familyData.filter(p => p.id !== child.id);
        });
    }

    editCurrentPerson() {
        if (!this.ensureEditMode()) return;
        const personId = this.currentPersonId;
        if (personId) {
            this.closeDetailModal();
            setTimeout(() => this.openEditModal(personId), 300);
        }
    }

    addChildToCurrent() {
        if (!this.ensureEditMode()) return;
        const personId = this.currentPersonId;
        if (personId) {
            this.closeDetailModal();
            setTimeout(() => this.openAddModal(personId), 300);
        }
    }

    zoom(factor) {
        this.zoomLevel *= factor;
        this.zoomLevel = Math.max(0.3, Math.min(2, this.zoomLevel));
        document.getElementById('familyTree').style.transform = `scale(${this.zoomLevel})`;
    }

    resetView() {
        this.zoomLevel = 1;
        document.getElementById('familyTree').style.transform = 'scale(1)';
        requestAnimationFrame(() => this.homeView());
    }

    homeView() {
        const container = document.getElementById('treeContainer');
        const tree = document.getElementById('familyTree');
        if (!container || !tree) return;

        const left = Math.max(0, tree.offsetLeft + tree.offsetWidth / 2 - container.clientWidth / 2);
        container.scrollTo({
            left,
            top: 0,
            behavior: 'smooth'
        });
    }

    toggleSpouses() {
        this.showSpouses = !this.showSpouses;
        const button = document.getElementById('toggleSpouseBtn');
        if (button) {
            button.textContent = this.showSpouses ? '隐藏配偶' : '显示配偶';
            button.setAttribute('aria-pressed', String(this.showSpouses));
        }
        this.render();
        requestAnimationFrame(() => this.drawConnectors());
    }

    loadSampleData() {
        if (!this.ensureEditMode()) return;
        if (this.familyData.length > 0) {
            if (!confirm('加载示例数据将清除当前所有数据，确定继续吗？')) return;
        }

        const familyName = this.siteSettings.familyName || '家族';
        const familySurname = familyName.replace(/氏|家族|族谱|家谱/g, '').trim().charAt(0) || '家';

        this.familyData = [
            { id: 'gen1_1', parentId: null, name: `${familySurname}德昌`, gender: 'male', birthYear: 1935, deathYear: 2005, generation: 1, spouse: '周淑芬', notes: `${familyName}创始人` },
            { id: 'gen2_1', parentId: 'gen1_1', name: `${familySurname}建国`, gender: 'male', birthYear: 1960, deathYear: null, generation: 2, spouse: '李玉兰', notes: '长子' },
            { id: 'gen2_2', parentId: 'gen1_1', name: `${familySurname}建华`, gender: 'male', birthYear: 1963, deathYear: null, generation: 2, spouse: '王秀英', notes: '次子' },
            { id: 'gen2_3', parentId: 'gen1_1', name: `${familySurname}建芳`, gender: 'female', birthYear: 1966, deathYear: null, generation: 2, spouse: '张志远', notes: '长女' },
            { id: 'gen3_1', parentId: 'gen2_1', name: `${familySurname}文博`, gender: 'male', birthYear: 1988, deathYear: null, generation: 3, spouse: '刘思琪', notes: '长孙' },
            { id: 'gen3_2', parentId: 'gen2_1', name: `${familySurname}文静`, gender: 'female', birthYear: 1991, deathYear: null, generation: 3, spouse: '', notes: '孙女' },
            { id: 'gen3_3', parentId: 'gen2_2', name: `${familySurname}子轩`, gender: 'male', birthYear: 1990, deathYear: null, generation: 3, spouse: '陈雨萱', notes: '孙子' },
            { id: 'gen3_4', parentId: 'gen2_3', name: '张婉婷', gender: 'female', birthYear: 1993, deathYear: null, generation: 3, spouse: '', notes: '外孙女' },
            { id: 'gen4_1', parentId: 'gen3_1', name: `${familySurname}浩然`, gender: 'male', birthYear: 2015, deathYear: null, generation: 4, spouse: '', notes: '曾孙' },
            { id: 'gen4_2', parentId: 'gen3_3', name: `${familySurname}诗涵`, gender: 'female', birthYear: 2018, deathYear: null, generation: 4, spouse: '', notes: '曾孙女' }
        ].map(p => ({ ...p, createdAt: new Date().toISOString() }));

        this.saveData();
        this.populateBranchControls();
        this.render();
        alert(`${familyName}族谱示例数据加载成功！`);
    }

    // 渲染族谱
    render() {
        const tree = document.getElementById('familyTree');
        let renderData = this.familyData;
        let rootMembers = renderData.filter(p => !p.parentId);

        if (this.activeBranchRootId) {
            const descendantIds = this.getDescendantIds(this.activeBranchRootId);
            renderData = this.familyData.filter(person => descendantIds.has(person.id));
            const branchRoot = this.familyData.find(person => person.id === this.activeBranchRootId);
            rootMembers = branchRoot ? [branchRoot] : [];
        }

        if (rootMembers.length === 0) {
            const familyName = this.siteSettings.familyName || '家族';
            const title = this.isEditMode ? `开始创建${familyName}族谱` : '暂无族谱数据';
            const description = this.isEditMode ? '点击上方的"添加始祖"按钮，或加载示例数据' : '请等待管理员在本地编辑并发布数据。';
            tree.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🏠</div>
                    <h3>${title}</h3>
                    <p>${description}</p>
                </div>
            `;
            return;
        }

        tree.innerHTML = rootMembers.map(person => this.renderPerson(person, renderData)).join('');
        requestAnimationFrame(() => this.drawConnectors());
    }

    // 渲染单个人物
    renderPerson(person, sourceData = this.familyData) {
        const children = sourceData.filter(p => p.parentId === person.id);
        const genderClass = person.gender === 'male' ? 'male' : 'female';
        const spouseGenderClass = person.gender === 'male' ? 'female' : 'male';
        const safeId = this.escapeAttribute(person.id);
        const safeName = this.escapeHTML(person.name);
        const safeSpouse = this.escapeHTML(person.spouse);
        const safePhoto = person.photo ? this.escapeAttribute(person.photo) : '';
        const safePhotoAlt = this.escapeAttribute(person.name);
        const cardHint = this.isEditMode ? '点击操作' : '查看详情';
        const spouseAvatar = person.gender === 'male' ? '👩' : '👨';
        const isSearchMatch = this.searchTerm && (
            person.name.includes(this.searchTerm) || 
            (person.spouse && person.spouse.includes(this.searchTerm)) ||
            (person.notes && person.notes.includes(this.searchTerm))
        );
        
        let avatarHtml;
        if (safePhoto) {
            avatarHtml = `<img src="${safePhoto}" alt="${safePhotoAlt}">`;
        } else {
            avatarHtml = person.gender === 'male' ? '👨' : '👩';
        }
        
        let birthDeath = '';
        if (person.birthYear) {
            birthDeath = person.birthYear + '年';
            if (person.deathYear) birthDeath += ' - ' + person.deathYear + '年';
        }

        let childrenHtml = '';
        if (children.length > 0) {
            childrenHtml = `
                <div class="children-container">
                    <div class="connector-lines"></div>
                    <div class="children-wrapper">
                        ${children.map(child => this.renderPerson(child, sourceData)).join('')}
                    </div>
                </div>
            `;
        }

        const spouseCardHtml = this.showSpouses && person.spouse ? `
            <div class="couple-link" aria-hidden="true">♡</div>
            <div class="member-card spouse-card ${spouseGenderClass}${isSearchMatch ? ' highlight-card' : ''}" title="配偶">
                <div class="member-avatar spouse-avatar">${spouseAvatar}</div>
                <div class="member-name">${safeSpouse}</div>
                <div class="member-role">配偶</div>
            </div>
        ` : '';

        return `
            <div class="family-member${isSearchMatch ? ' search-match' : ''}" data-id="${safeId}">
                <div class="couple-unit${this.showSpouses && person.spouse ? ' has-spouse' : ''}">
                    <div class="member-card ${genderClass}${isSearchMatch ? ' highlight-card' : ''}">
                        <div class="member-avatar">${avatarHtml}</div>
                        <div class="member-name">${safeName}</div>
                        ${birthDeath ? `<div class="member-info">${birthDeath}</div>` : ''}
                        <div class="member-hint">${cardHint}</div>
                    </div>
                    ${spouseCardHtml}
                </div>
                ${childrenHtml}
            </div>
        `;
    }

    // 动态绘制连接线
    drawConnectors() {
        const containers = document.querySelectorAll('.children-container');
        containers.forEach(container => {
            const wrapper = container.querySelector('.children-wrapper');
            const connectorDiv = container.querySelector('.connector-lines');
            if (!wrapper || !connectorDiv) return;

            const children = wrapper.querySelectorAll(':scope > .family-member');
            if (children.length === 0) return;

            connectorDiv.innerHTML = '';

            const parentAnchor = container.parentElement.querySelector(':scope > .couple-unit > .member-card:not(.spouse-card)') ||
                container.parentElement.querySelector(':scope > .member-card');
            if (!parentAnchor) return;
            
            const containerRect = container.getBoundingClientRect();
            const parentRect = parentAnchor.getBoundingClientRect();
            const parentCenterX = parentRect.left + parentRect.width / 2 - containerRect.left;

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:40px;overflow:visible;pointer-events:none;';

            const createLine = (x1, y1, x2, y2) => {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', x1); line.setAttribute('y1', y1);
                line.setAttribute('x2', x2); line.setAttribute('y2', y2);
                line.setAttribute('stroke', '#B8860B'); line.setAttribute('stroke-width', '2');
                return line;
            };

            const createPath = (d) => {
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', d); path.setAttribute('stroke', '#B8860B');
                path.setAttribute('stroke-width', '2'); path.setAttribute('fill', 'none');
                return path;
            };

            const childPositions = [];
            children.forEach(child => {
                const childAnchor = child.querySelector(':scope > .couple-unit > .member-card:not(.spouse-card)') ||
                    child.querySelector(':scope > .member-card');
                if (childAnchor) {
                    const childRect = childAnchor.getBoundingClientRect();
                    childPositions.push(childRect.left + childRect.width / 2 - containerRect.left);
                }
            });

            if (childPositions.length === 0) return;

            if (childPositions.length === 1) {
                const childX = childPositions[0];
                if (Math.abs(parentCenterX - childX) < 2) {
                    svg.appendChild(createLine(parentCenterX, 0, parentCenterX, 40));
                } else {
                    const midY = 20;
                    const dir = childX > parentCenterX ? 1 : -1;
                    svg.appendChild(createPath(`M ${parentCenterX} 0 V ${midY - 8} Q ${parentCenterX} ${midY} ${parentCenterX + dir * 8} ${midY} H ${childX - dir * 8} Q ${childX} ${midY} ${childX} ${midY + 8} V 40`));
                }
            } else {
                const firstX = childPositions[0];
                const lastX = childPositions[childPositions.length - 1];
                const midY = 20;

                svg.appendChild(createLine(parentCenterX, 0, parentCenterX, midY));

                if (parentCenterX < firstX) {
                    svg.appendChild(createPath(`M ${parentCenterX} ${midY} H ${firstX}`));
                } else if (parentCenterX > lastX) {
                    svg.appendChild(createPath(`M ${parentCenterX} ${midY} H ${lastX}`));
                }

                svg.appendChild(createLine(firstX, midY, lastX, midY));

                childPositions.forEach(x => {
                    svg.appendChild(createLine(x, midY, x, 40));
                });
            }

            connectorDiv.appendChild(svg);
        });
    }
}

// 确保 DOM 加载完成后再初始化
document.addEventListener('DOMContentLoaded', () => {
    window.familyTree = new FamilyTree();
});
