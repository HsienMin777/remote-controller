// ==========================================
// 🌟 共用頁尾 Footer（品牌介紹 + Contact Us + 版權宣告）
// 每個獨立頁面只需在 .main-content 內容最後面放一個 <div id="appFooter"></div>
// 佔位，並在其後載入這支腳本，即可注入一致的頁尾。
// CSS 規則（.site-footer/.footer-inner/.footer-brand/.footer-contact/...）
// 沿用各頁面自己 <style> 裡已經定義好的樣式（與 shared-header.js/shared-sidebar.js
// 是同一套慣例），這支腳本只負責注入 HTML 結構。
// ==========================================
(function renderAppFooter() {
    const mount = document.getElementById('appFooter');
    if (!mount) return;

    mount.outerHTML = `
        <footer class="site-footer">
            <div class="footer-inner">
                <div class="footer-brand">
                    <div class="logo" style="margin: 0;">
                        <div class="logo-icon">O</div>
                        OfferDash
                    </div>
                    <p>AI 驅動的模擬面試教練，幫助求職者用數據與練習征服每一場面試。</p>
                </div>

                <div class="footer-contact">
                    <h3>Contact Us</h3>
                    <div class="footer-contact-list">
                        <!-- Email 為實際收信信箱，其餘為範例資料，請替換成正式的電話／服務時間／社群連結 -->
                        <a href="mailto:bbei8640@gmail.com" class="footer-contact-item">
                            <span class="footer-contact-label">Email</span> bbei8640@gmail.com
                        </a>
                        <a href="tel:+886909770018" class="footer-contact-item">
                            <span class="footer-contact-label">Phone</span> +886 909-770-018
                        </a>
                        <div class="footer-contact-item">
                            <span class="footer-contact-label">Hours</span> Mon - Fri: 9:00 AM - 6:00 PM (GMT+8)
                        </div>
                    </div>
                    <div class="footer-social">
                        <a href="https://www.facebook.com/bei.bei.878025?locale=zh_TW" target="_blank" rel="noopener">Facebook</a>
                        <a href="https://www.instagram.com/ni_x_m_0919/" target="_blank" rel="noopener">Instagram</a>
                    </div>
                </div>
            </div>
            <div class="footer-bottom">© 2026 OfferDash. All rights reserved.</div>
        </footer>
    `;
})();
