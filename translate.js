const fs = require('fs');
const path = require('path');

// Sadece Controller dosyalarını hedefliyoruz
const filesToTranslate = [
    path.join(__dirname, 'controllers', 'apiController.js'),
    path.join(__dirname, 'controllers', 'erpController.js')
];

const translations = {
    // ---- TEMEL KELİMELER ----
    '"Select"': '"Seçiniz"',
    '"Select seat plan"': '"Koltuk planı seçiniz"',
    '"Select license plate"': '"Plaka seçiniz"',
    '"Not selected"': '"Seçilmedi"',
    '"Added"': '"Eklendi"',
    '"Updated"': '"Güncellendi"',
    '"Deleted"': '"Silindi"',
    '"Saved"': '"Kaydedildi"',
    '"Driver"': '"Şoför"',
    '"Assistant"': '"Muavin"',
    '"Hostess"': '"Host"',
    '"Unspecified Branch"': '"Belirtilmeyen Şube"',
    '"Unspecified User"': '"Belirtilmeyen Kullanıcı"',
    '"All"': '"Tümü"',

    // ---- HATA VE BAŞARI MESAJLARI ----
    '"An unexpected error occurred"': '"Beklenmeyen bir hata oluştu"',
    '"Unexpected error"': '"Beklenmeyen hata"',
    '"from, to, and date are required."': '"kalkış, varış ve tarih alanları zorunludur."',
    '"From/To stop not found."': '"Kalkış/Varış durağı bulunamadı."',
    '"tripId, fromStopId, and toStopId are required."': '"tripId, fromStopId ve toStopId alanları zorunludur."',
    '"At least one seatNumber must be provided."': '"En az bir koltuk numarası belirtilmelidir."',
    '"genders array must have the same length as seatNumbers."': '"Cinsiyet dizisi koltuk numaralarıyla aynı uzunlukta olmalıdır."',
    '"Payment not found."': '"Ödeme bulunamadı."',
    '"Trip not found."': '"Sefer bulunamadı."',
    '"Payment record not found."': '"Ödeme kaydı bulunamadı."',
    '"This transaction has already been processed."': '"Bu işlem zaten gerçekleştirilmiş."',
    '"Error creating ticket."': '"Bilet oluşturulurken hata meydana geldi."',
    '"Please fill in all required fields."': '"Lütfen tüm zorunlu alanları doldurun."',
    '"Invalid ID Number."': '"Geçersiz Kimlik Numarası."',
    '"A user with this ID Number already exists."': '"Bu Kimlik Numarasına sahip bir müşteri/kullanıcı zaten var."',
    '"Registration failed."': '"Kayıt başarısız oldu."',
    '"ID Number and password are required."': '"Kimlik Numarası ve şifre zorunludur."',
    '"User not found."': '"Kullanıcı bulunamadı."',
    '"No password set for this user."': '"Bu kullanıcı için şifre ayarlanmamış."',
    '"Incorrect password."': '"Hatalı şifre."',
    '"Login failed."': '"Giriş başarısız."',
    '"ID required."': '"ID zorunludur."',
    '"Could not retrieve profile info."': '"Profil bilgisi alınamadı."',
    '"User ID missing."': '"Kullanıcı ID eksik."',
    '"Update failed."': '"Güncelleme başarısız."',
    '"Could not retrieve tickets."': '"Biletler alınamadı."',
    '"Ticket not found."': '"Bilet bulunamadı."',
    '"Ticket not found"': '"Bilet bulunamadı"',
    '"Transaction successful."': '"İşlem başarılı."',
    '"Transaction failed."': '"İşlem başarısız oldu."',
    '"Trip information not found."': '"Sefer bilgisi bulunamadı."',
    '"Please select at least one seat."': '"Lütfen en az bir koltuk seçiniz."',
    '"Selected stops not found in trip route."': '"Seçilen duraklar sefer güzergahında bulunamadı."',
    '"Please select a valid route."': '"Lütfen geçerli bir güzergah seçiniz."',
    '"No valid seat selection found."': '"Geçerli bir koltuk seçimi bulunamadı."',
    '"Please enter an ID number."': '"Lütfen kimlik numarası giriniz."',
    '"Invalid trip parameters."': '"Geçersiz sefer parametreleri."',
    '"Tickets saved successfully."': '"Biletler başarıyla kaydedildi."',
    '"An error occurred during save."': '"Kaydetme sırasında bir hata oluştu."',
    '"No ticket information provided."': '"Bilet bilgisi sağlanmadı."',
    '"Invalid ticket information provided."': '"Geçersiz bilet bilgisi sağlandı."',
    '"Ticket price cannot be changed during editing."': '"Bilet fiyatı düzenleme sırasında değiştirilemez."',
    '"Tickets successfully canceled."': '"Biletler başarıyla iptal edildi."',
    '"No eligible records found to delete."': '"Silinecek uygun kayıt bulunamadı."',
    '"Pending ticket(s) successfully deleted."': '"Bekleyen bilet(ler) başarıyla silindi."',
    '"Tickets successfully moved to open status."': '"Biletler başarıyla açık duruma alındı."',
    '"PNR is missing."': '"PNR eksik."',
    '"Open ticket not found."': '"Açık bilet bulunamadı."',
    '"Could not retrieve open ticket information."': '"Açık bilet bilgisi alınamadı."',
    '"Invalid ticket information."': '"Geçersiz bilet bilgisi."',
    '"Open ticket information missing."': '"Açık bilet bilgisi eksik."',
    '"Some selected open tickets could not be found."': '"Seçilen bazı açık biletler bulunamadı."',
    '"Number of selected tickets does not match target seats."': '"Seçilen bilet sayısı hedef koltuk sayısıyla eşleşmiyor."',
    '"Target trip not found."': '"Hedef sefer bulunamadı."',
    '"Tickets to move not found."': '"Taşınacak biletler bulunamadı."',
    '"Ticket move operation completed successfully."': '"Bilet transfer işlemi başarıyla tamamlandı."',
    '"Target trip information missing."': '"Hedef sefer bilgisi eksik."',
    '"PNR missing or invalid."': '"PNR eksik veya geçersiz."',
    '"Seat information missing."': '"Koltuk bilgisi eksik."',
    '"Invalid departure stop information."': '"Geçersiz kalkış durağı bilgisi."',
    '"Invalid arrival stop information."': '"Geçersiz varış durağı bilgisi."',
    '"Open ticket to attach not found."': '"Bağlanacak açık bilet bulunamadı."',
    '"Please select a valid arrival stop."': '"Lütfen geçerli bir varış durağı seçiniz."',
    '"Arrival stop must be after departure stop."': '"Varış durağı kalkış durağından sonra olmalıdır."',
    '"Open ticket successfully attached to trip."': '"Açık bilet sefere başarıyla bağlandı."',
    '"An error occurred while attaching ticket."': '"Bilet bağlanırken bir hata oluştu."',
    '"Invalid plan information."': '"Geçersiz plan bilgisi."',
    '"You cannot delete the only existing bus plan. Please add a new plan before deleting this one."': '"Mevcut olan tek otobüs planını silemezsiniz. Lütfen silmeden önce yeni bir plan ekleyin."',
    '"Bus plan not found."': '"Otobüs planı bulunamadı."',
    '"Invalid data."': '"Geçersiz veri."',
    '"Invalid price information."': '"Geçersiz fiyat bilgisi."',
    '"Price not found."': '"Fiyat bulunamadı."',
    '"Please fill in the license plate, bus model, and vehicle phone number fields."': '"Lütfen plaka, otobüs modeli ve araç telefonu alanlarını doldurunuz."',
    '"Invalid bus information."': '"Geçersiz otobüs bilgisi."',
    '"Bus not found."': '"Otobüs bulunamadı."',
    '"Bus updated and notified to UETDS."': '"Otobüs güncellendi ve UETDS sistemine bildirildi."',
    '"Staff updated and synced with UETDS."': '"Personel güncellendi ve UETDS sistemiyle senkronize edildi."',
    '"Trip activated."': '"Sefer aktifleştirildi."',
    '"Trip canceled."': '"Sefer iptal edildi."',
    '"Trip status could not be updated."': '"Sefer durumu güncellenemedi."',
    '"Invalid staff information."': '"Geçersiz personel bilgisi."',
    '"Staff not found."': '"Personel bulunamadı."',
    '"Stop not found."': '"Durak bulunamadı."',
    '"Stop name is required."': '"Durak adı zorunludur."',
    '"Please select a valid place."': '"Lütfen geçerli bir yer seçiniz."',
    '"Please select a valid UETDS code."': '"Lütfen geçerli bir UETDS kodu seçiniz."',
    '"Selected UETDS code not found."': '"Seçilen UETDS kodu bulunamadı."',
    '"Invalid stop information."': '"Geçersiz durak bilgisi."',
    '"Route code, title, and description are required."': '"Hat kodu, adı ve açıklaması zorunludur."',
    '"Could not parse route stops data."': '"Hat durakları verisi ayrıştırılamadı."',
    '"You must add at least one stop for the route."': '"Hat için en az bir durak eklemelisiniz."',
    '"Stop information missing or invalid."': '"Durak bilgisi eksik veya geçersiz."',
    '"Stop information missing."': '"Durak bilgisi eksik."',
    '"Invalid route ID."': '"Geçersiz hat ID\'si."',
    '"Invalid route information."': '"Geçersiz hat bilgisi."',
    '"Route not found."': '"Hat bulunamadı."',
    '"An error occurred while retrieving the trip list."': '"Sefer listesi alınırken bir hata oluştu."',
    '"Location information not found."': '"Konum bilgisi bulunamadı."',
    '"Invalid branch information."': '"Geçersiz şube bilgisi."',
    '"Branch not found."': '"Şube bulunamadı."',
    '"Password is required for new users."': '"Yeni kullanıcılar için şifre zorunludur."',
    '"Invalid user information."': '"Geçersiz kullanıcı bilgisi."',
    '"Register record not found."': '"Kasa kaydı bulunamadı."',
    '"An error occurred."': '"Bir hata oluştu."',
    '"Invalid transaction type."': '"Geçersiz işlem türü."',
    '"Payment already processed."': '"Ödeme zaten işlenmiş."',
    '"You are not authorized to confirm."': '"Bunu onaylamaya yetkiniz yok."',
    '"Date information is missing."': '"Tarih bilgisi eksik."',
    '"Invalid date format."': '"Geçersiz tarih formatı."',
    '"Server error."': '"Sunucu hatası."',
    '"Note not found"': '"Not bulunamadı"',
    '"Note updated successfully"': '"Not başarıyla güncellendi"',
    '"Note deleted successfully"': '"Not başarıyla silindi"',
    '"Internal Server Error"': '"Sunucu Hatası"',
    '"Trip ID required"': '"Sefer ID zorunludur"',
    '"Invalid restriction information."': '"Geçersiz kısıtlama bilgisi."',
    '"No restriction changes found."': '"Herhangi bir kısıtlama değişikliği bulunamadı."',
    '"No active trip found to apply."': '"Uygulanacak aktif sefer bulunamadı."',
    '"Restriction changes applied to relevant trips."': '"Kısıtlama değişiklikleri ilgili seferlere uygulandı."',
    '"Invalid trip or stop information."': '"Geçersiz sefer veya durak bilgisi."',
    '"Please select a valid direction."': '"Lütfen geçerli bir yön seçiniz."',
    '"Please enter a valid duration."': '"Lütfen geçerli bir süre giriniz."',
    '"Duration cannot be 0."': '"Süre 0 olamaz."',
    '"You are not authorized for this operation."': '"Bu işlem için yetkiniz bulunmuyor."',
    '"Trip stop not found."': '"Sefer durağı bulunamadı."',
    '"Route stops not found."': '"Hat durakları bulunamadı."',
    '"Time adjusted and UETDS updated."': '"Saat ayarlandı ve UETDS güncellendi."',
    '"Trip time could not be updated."': '"Sefer saati güncellenemedi."',
    '"Revenue information could not be retrieved."': '"Gelir bilgisi alınamadı."',
    '"Sender name is required."': '"Gönderici adı zorunludur."',
    '"Sender phone information is required."': '"Gönderici telefonu zorunludur."',
    '"Sender ID info is required."': '"Gönderici kimlik bilgisi zorunludur."',
    '"Invalid payment type."': '"Geçersiz ödeme türü."',
    '"Please enter a valid price."': '"Lütfen geçerli bir fiyat giriniz."',
    '"Session information not found."': '"Oturum bilgisi bulunamadı."',
    '"Cargo record not found."': '"Kargo kaydı bulunamadı."',
    '"An error occurred during cargo refund."': '"Kargo iadesi sırasında bir hata oluştu."',
    '"Could not retrieve cargo list."': '"Kargo listesi alınamadı."',
    '"User created."': '"Kullanıcı oluşturuldu."',
    '"Register reset. Previous balance: "': '"Kasa sıfırlandı. Önceki bakiye: "',
    '"Account cut reverted | "': '"Hesap kesimi geri alındı | "',
    '"Account cut reverted"': '"Hesap kesimi geri alındı"',
    '"Account not found."': '"Hesap bulunamadı."',
    '"Account information could not be retrieved."': '"Hesap bilgisi alınamadı."',
    '"Account revert failed."': '"Hesap kesimi geri alma işlemi başarısız oldu."',
    '"Account receipt could not be generated."': '"Hesap fişi oluşturulamadı."',
    '"Seat plan not found for this trip."': '"Bu sefer için koltuk planı bulunamadı."',
    '"Seat plan report could not be generated."': '"Koltuk planı raporu oluşturulamadı."',
    '"Could not generate sales and refunds report."': '"Satış ve iadeler raporu oluşturulamadı."',
    '"Web ticket report could not be generated."': '"Web biletleri raporu oluşturulamadı."',
    '"Could not generate external return tickets report."': '"Dış hat dönüş biletleri raporu oluşturulamadı."',
    '"Could not generate upcoming tickets report."': '"İleri tarihli biletler raporu oluşturulamadı."',
    '"Could not generate bus transactions report."': '"Otobüs işlemleri raporu oluşturulamadı."',
    '"An error occurred while destroying the session."': '"Oturum sonlandırılırken bir hata oluştu."',
    '"This username is already taken."': '"Bu kullanıcı adı zaten alınmış."',
    '"Phone number must be 10 digits."': '"Telefon numarası 10 haneli olmalıdır."',
    '"Profile could not be updated."': '"Profil güncellenemedi."',
    '"Current password is required."': '"Mevcut şifre zorunludur."',
    '"New password is required."': '"Yeni şifre zorunludur."',
    '"New password must be at least 6 characters."': '"Yeni şifre en az 6 karakter olmalıdır."',
    '"New passwords do not match."': '"Yeni şifreler eşleşmiyor."',
    '"Current password is incorrect."': '"Mevcut şifre hatalı."',
    '"New password cannot be the same as the old password."': '"Yeni şifre eski şifreyle aynı olamaz."',
    '"Password could not be updated."': '"Şifre güncellenemedi."',
    '"Cargo refunded"': '"Kargo iade edildi"',
    '"Ticket refunded | "': '"Bilet iade edildi | "',
    '"Cargo | "': '"Kargo | "'
};

filesToTranslate.forEach(fullPath => {
    if (!fs.existsSync(fullPath)) {
        console.warn(`⚠️ Dosya bulunamadı, atlanıyor: ${fullPath}`);
        return;
    }

    let content = fs.readFileSync(fullPath, 'utf8');
    let modified = false;

    // Sabit metinleri çevir
    for (const [english, turkish] of Object.entries(translations)) {
        if (content.includes(english)) {
            content = content.split(english).join(turkish);
            modified = true;
        }

        // Tek tırnaklı versiyonunu da kontrol et
        const engSingle = english.replace(/"/g, "'");
        const trSingle = turkish.replace(/"/g, "'");
        if (content.includes(engSingle)) {
            content = content.split(engSingle).join(trSingle);
            modified = true;
        }
    }

    // Template Literal (Şablon) ile yazılmış dinamik İngilizce metinler (Regex ile)
    const regexTranslations = [
        {
            regex: /`Seat number \$\{seatLabel\} is not available for the selected route.`/g,
            replacement: '`${seatLabel} numaralı koltuk seçilen güzergah için uygun değil.`'
        },
        {
            regex: /`You selected multiple tickets for ID number \$\{normalizedIdNumber\}.`/g,
            replacement: '`${normalizedIdNumber} kimlik numarası için birden fazla bilet seçtiniz.`'
        },
        {
            regex: /`A ticket already exists for ID number \$\{existingTicketWithSameId.idNumber\} on this trip.`/g,
            replacement: '`Bu seferde ${existingTicketWithSameId.idNumber} kimlik numarasına sahip bir bilet zaten var.`'
        },
        {
            regex: /`Maximum reservation limit \(\$\{reservationCheck\.limit\}\) cannot be exceeded.`/g,
            replacement: '`Maksimum rezervasyon limiti (${reservationCheck.limit}) aşılamaz.`'
        },
        {
            regex: /`Single seat limit \(\$\{singleSeatCheck\.limit\}\) exceeded\. Please select different seats.`/g,
            replacement: '`Tekli koltuk limiti (${singleSeatCheck.limit}) aşıldı. Lütfen farklı koltuklar seçiniz.`'
        },
        {
            regex: /`\$\{createdTrips\.length\} trips added.`/g,
            replacement: '`${createdTrips.length} sefer eklendi.`'
        },
        {
            regex: /`Register transferred from user \$\{users\.find\(u => u\.id == payment\.payerId\)\.name\}\.`/g,
            replacement: '`${users.find(u => u.id == payment.payerId).name} adlı kullanıcıdan kasa devralındı.`'
        },
        {
            regex: /`Payment received from user \$\{users\.find\(u => u\.id == payment\.payerId\)\.name\}\.`/g,
            replacement: '`${users.find(u => u.id == payment.payerId).name} adlı kullanıcıdan ödeme alındı.`'
        },
        {
            regex: /`Register transferred to user \$\{users\.find\(u => u\.id == payment\.receiverId\)\.name\}\. Transfer: \$\{payment\.amount\}₺`/g,
            replacement: '`${users.find(u => u.id == payment.receiverId).name} adlı kullanıcıya kasa devredildi. Tutar: ${payment.amount}₺`'
        },
        {
            regex: /`Payment made to user \$\{users\.find\(u => u\.id == payment\.receiverId\)\.name\}\.`/g,
            replacement: '`${users.find(u => u.id == payment.receiverId).name} adlı kullanıcıya ödeme yapıldı.`'
        },
        {
            regex: /`Open ticket sold \| \$\{fromStop\?\.title \|\| ""\} - \$\{toStop\?\.title \|\| ""\}`/g,
            replacement: '`Açık bilet satıldı | ${fromStop?.title || ""} - ${toStop?.title || ""}`'
        }
    ];

    regexTranslations.forEach(item => {
        if (item.regex.test(content)) {
            content = content.replace(item.regex, item.replacement);
            modified = true;
        }
    });

    if (modified) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`✅ Başarıyla Çevrildi: ${fullPath}`);
    } else {
        console.log(`ℹ️ Çevrilecek bir şey bulunamadı: ${fullPath}`);
    }
});

console.log("Controller dosyaları başarıyla Türkçeleştirildi! Dayına dua et :)");