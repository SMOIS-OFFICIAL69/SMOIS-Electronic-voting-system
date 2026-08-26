/* MC OF ISKKU 2026 - Data Export System (Excel, CSV, PDF) */

const Export = {
    openExportModal: function(dashboardData) {
        if (!dashboardData) {
            App.showToast('ไม่มีข้อมูลสำหรับ Export', 'error');
            return;
        }

        const choice = prompt('เลือกรูปแบบ Export:\n1. CSV (แนะนำสำหรับ Excel)\n2. Excel (.xls XML)\n3. PDF (พิมพ์รายงาน)', '1');
        if (choice === '1') {
            this.exportCSV(dashboardData);
        } else if (choice === '2') {
            this.exportExcelXML(dashboardData);
        } else if (choice === '3') {
            this.exportPDF();
        }
    },

    exportCSV: function(dashboardData) {
        const round = dashboardData.round;
        const judges = dashboardData.judges;
        const leaderboard = dashboardData.leaderboard;

        let csv = '\uFEFF'; // UTF-8 BOM for Excel Thai language support
        csv += `รายงานผลการลงคะแนนการแข่งขัน MC OF ISKKU 2026\n`;
        csv += `รอบการแข่งขัน: ${round.name} — ${round.subtitle}\n`;
        csv += `วันที่ส่งออกข้อมูล: ${new Date().toLocaleString('th-TH')}\n\n`;

        // Headers
        csv += `"อันดับ","รหัสผู้เข้าแข่งขัน","ชื่อ-นามสกุล","คณะ/สาขา",`;
        judges.forEach((j, idx) => {
            csv += `"กรรมการคนที่ ${idx + 1} (${j.name})",`;
        });
        csv += `"คะแนนรวม","คะแนนเฉลี่ย","สถานะการลงคะแนน"\n`;

        // Data Rows
        leaderboard.forEach(item => {
            const c = item.contestant;
            csv += `"${item.rank}","${c.code}","${c.name}","${c.faculty}",`;

            judges.forEach(j => {
                const score = item.judge_scores[j.id];
                if (score && score.submitted) {
                    csv += `"${score.total.toFixed(2)}",`;
                } else {
                    csv += `"ยังไม่ส่ง",`;
                }
            });

            csv += `"${item.sum_score.toFixed(2)}","${item.avg_score.toFixed(2)}","${item.voted_judges_count}/${dashboardData.total_judges} ท่าน"\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `MC_ISKKU_2026_${round.code}_Score_Report.csv`;
        link.click();
        App.showToast('ส่งออกไฟล์ CSV เรียบร้อยแล้ว', 'success');
    },

    exportExcelXML: function(dashboardData) {
        const round = dashboardData.round;
        const judges = dashboardData.judges;
        const leaderboard = dashboardData.leaderboard;

        let html = `
            <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
            <head><meta charset="utf-8"/></head>
            <body>
            <h2>รายงานผลการลงคะแนน MC OF ISKKU 2026</h2>
            <h3>รอบ: ${round.name} — ${round.subtitle}</h3>
            <table border="1">
                <tr style="background-color: #fbbf24; color: #000; font-weight: bold;">
                    <th>อันดับ</th>
                    <th>รหัส</th>
                    <th>ชื่อ-นามสกุล</th>
                    <th>คณะ/สาขา</th>
                    ${judges.map(j => `<th>${j.name}</th>`).join('')}
                    <th>คะแนนรวม</th>
                    <th>คะแนนเฉลี่ย</th>
                </tr>
                ${leaderboard.map(item => `
                    <tr>
                        <td>${item.rank}</td>
                        <td>${item.contestant.code}</td>
                        <td>${item.contestant.name}</td>
                        <td>${item.contestant.faculty}</td>
                        ${judges.map(j => {
                            const score = item.judge_scores[j.id];
                            return `<td>${score && score.submitted ? score.total.toFixed(2) : '-'}</td>`;
                        }).join('')}
                        <td><b>${item.sum_score.toFixed(2)}</b></td>
                        <td style="color: #d97706;"><b>${item.avg_score.toFixed(2)}</b></td>
                    </tr>
                `).join('')}
            </table>
            </body>
            </html>
        `;

        const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `MC_ISKKU_2026_${round.code}_Report.xls`;
        link.click();
        App.showToast('ส่งออกไฟล์ Excel เรียบร้อยแล้ว', 'success');
    },

    exportPDF: function() {
        window.print();
    }
};
