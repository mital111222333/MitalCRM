// Oʻzbekcha (lotin) — the agent's cabinet (me.html) in Uzbek. me.js shows the page in Russian; when the agent picks «Oʻzbekcha»
// it replaces these Russian phrases on the screen (text, placeholders, alerts). Longer phrases are replaced first, so a whole
// sentence wins over its words; a phrase that starts / ends with a letter is matched only as whole words («план» never eats «плана»).
// Data from LINKO (client names, goods) is not translated.
// Add a phrase: [ 'как на экране по-русски', 'oʻzbekcha' ]. Keep the Russian part exactly as me.js writes it.
window.ME_UZ = [
  // header, tabs, common
  ['🔁 Руководитель просит провести сверку ещё раз — полностью, все товары.', '🔁 Rahbar omborni yana bir bor toʻliq, barcha tovarlar boʻyicha sanashni soʻrayapti.'], ['Считайте внимательно: коробки и штуки, отложенное под заказы тоже.', 'Diqqat bilan sanang: qutilar va donalar, buyurtmalarga ajratilganlari ham.'],
  ['🗑 Брак', '🗑 Yaroqsiz'], ['Что случилось (помято, протекло, разбито, просрочено) — обязательно', 'Nima boʻldi (ezilgan, oqgan, singan, muddati oʻtgan) — majburiy'], ['Фото брака — обязательно', 'Yaroqsiz tovar surati — majburiy'], ['Для брака нужно фото', 'Yaroqsiz tovar uchun surat kerak'], ['Напишите, что случилось с товаром', 'Tovarga nima boʻlganini yozing'],
  ['сфотографируйте повреждённый товар и отложите его отдельно.', 'shikastlangan tovarni suratga oling va alohida qoʻying.'], ['В сверке брак не считайте', 'Sanoqda yaroqsizni sanamang'], ['— руководитель спишет его в LINKO.', '— rahbar uni LINKOda hisobdan chiqaradi.'],
  ['🔊 Называю товар — вы говорите количество («5 коробок 3 штуки», «ноль», «дальше», «повтори»)', '🔊 Tovarni aytaman — siz sonini ayting («5 quti 3 ta», «nol», «keyingi», «qaytar»)'], ['🔊 Буду называть товары вслух', '🔊 Tovarlarni ovoz chiqarib aytaman'], ['🔇 Названия вслух выключены', '🔇 Ovozli nomlar oʻchirilgan'], ['✓ Все товары посчитаны', '✓ Barcha tovarlar sanaldi'], ['пропущено', 'oʻtkazildi'], ['Не понял', 'Tushunmadim'], ['скажите число', 'sonni ayting'],
  ['📋 Сверка', '📋 Sanoq'], ['🚚 Приход / отгрузка', '🚚 Kirim / chiqim'], ['⚠ Заканчивается', '⚠ Tugayapti'], ['🏆 Мой рейтинг', '🏆 Mening reytingim'],
  ['⚠ Что заканчивается на складе', '⚠ Omborda nima tugayapti'], ['✓ Всё есть — ничего не заканчивается', '✓ Hammasi bor — hech narsa tugamayapti'], ['✕ Закончился', '✕ Tugadi'], ['⊘ Всё отложено под заказы', '⊘ Hammasi buyurtmalarga ajratilgan'], ['▼ Осталось мало', '▼ Kam qoldi'],
  ['Отметьте, что нужно завезти, и отправьте руководителю.', 'Nima keltirish kerakligini belgilang va rahbarga yuboring.'], ['📨 Попросить завезти', '📨 Keltirishni soʻrash'], ['Отметьте товары', 'Tovarlarni belgilang'], ['есть на складе', 'omborda bor'], ['По остаткам', 'Qoldiqlar boʻyicha'],
  ['Данных пока нет — они появятся, когда руководитель обновит остатки складов.', 'Hozircha maʼlumot yoʻq — rahbar ombor qoldiqlarini yangilaganda paydo boʻladi.'],
  ['сверок подряд без расхождений', 'ketma-ket farqsiz sanoq'], ['лучший результат', 'eng yaxshi natija'], ['в этом месяце без расхождений', 'bu oy farqsiz'], ['вовремя — до', 'oʻz vaqtida —'], ['место среди', 'oʻrin, jami'], ['складов', 'ombor'], ['в этом месяце', 'bu oy'], ['удержано за недостачу в этом месяце', 'bu oy kamomad uchun ushlab qolindi'],
  ['Последние', 'Oxirgi'], ['сверок', 'sanoq'], ['сошлось', 'mos keldi'], ['были расхождения', 'farqlar bor edi'], ['расхождений', 'farqlar'], ['опоздание', 'kechikish'], ['удержано', 'ushlab qolindi'],
  ['Здесь появятся ваша история сверок и место среди складов — после первых сверок.', 'Bu yerda sanoqlaringiz tarixi va omborlar orasidagi oʻrningiz birinchi sanoqlardan keyin paydo boʻladi.'],
  ['📥 Приход', '📥 Kirim'], ['📤 Отгрузка', '📤 Chiqim'], ['↩ Возврат', '↩ Qaytarish'], ['Откуда (поставщик, машина, другой склад)', 'Qayerdan (yetkazib beruvchi, mashina, boshqa ombor)'], ['Кому (агент, клиент, другой склад)', 'Kimga (agent, mijoz, boshqa ombor)'], ['От кого (клиент, агент)', 'Kimdan (mijoz, agent)'],
  ['🔍 Найти товар и добавить', '🔍 Tovarni topib qoʻshing'], ['Найдите товары поиском — они появятся здесь — и укажите количество (коробки и штуки).', 'Tovarlarni qidiruv orqali toping — ular shu yerda chiqadi — va sonini kiriting (quti va dona).'], ['Итого', 'Jami'], ['Не найдено', 'Topilmadi'],
  ['Фото накладной (лучше приложить)', 'Yuk xati surati (biriktirgan maʼqul)'], ['Комментарий', 'Izoh'], ['Очистить', 'Tozalash'], ['Отправить руководителю', 'Rahbarga yuborish'], ['Мои записи', 'Mening yozuvlarim'], ['Очистить список?', 'Roʻyxat tozalansinmi?'],
  ['Записывайте то, что физически приняли или отдали. Руководитель сверит с накладной и LINKO.', 'Haqiqatda qabul qilgan yoki bergan narsani yozing. Rahbar yuk xati va LINKO bilan solishtiradi.'], ['Добавьте товары и укажите количество', 'Tovarlarni qoʻshing va sonini kiriting'], ['отправлен руководителю', 'rahbarga yuborildi'],
  ['🎤 — считать голосом: называйте количество по порядку.', '🎤 — ovoz bilan sanash: sonini tartib bilan ayting.'], ['Одно число у товара в коробках — это коробки; со словом «штук» — штуки.', 'Qutili tovarda bitta son — bu quti; «ta» soʻzi bilan — dona.'], ['Можно диктовать: микрофон на клавиатуре телефона.', 'Ovoz bilan kiritish mumkin: telefon klaviaturasidagi mikrofon.'],
  ['🔴 Слушаю: называйте количество по порядку («5 коробок 3 штуки», «ноль», «дальше»)', '🔴 Eshityapman: sonini tartib bilan ayting («5 quti 3 ta», «nol», «keyingi»)'], ['Разрешите доступ к микрофону в настройках браузера', 'Brauzer sozlamalarida mikrofonga ruxsat bering'], ['Все товары посчитаны', 'Barcha tovarlar sanaldi'],
  ['Мой ассистент JUMAVOY', 'Mening yordamchim JUMAVOY'], ['Ассистент', 'Yordamchi'], ['Ассистент пока доступен только агентам', 'Yordamchi hozircha faqat agentlar uchun'], ['Бот ассистента ещё не подключён — скажите руководителю', 'Yordamchi bot hali ulanmagan — rahbaringizga ayting'], ['Не удалось — проверьте интернет', 'Boʻlmadi — internetni tekshiring'], ['Сессия устарела — войдите снова', 'Sessiya eskirdi — qaytadan kiring'],
  ['Мой кабинет — MITAL', 'Mening kabinetim — MITAL'], ['Мой кабинет', 'Mening kabinetim'], ['🔄 Обновить', '🔄 Yangilash'], ['Обновляю…', 'Yangilanmoqda…'], ['Выйти', 'Chiqish'],
  ['Главное', 'Asosiy'], ['Сбор', 'Undiruv'], ['Оплаты', 'Toʻlovlar'], ['Маршрут', 'Marshrut'], ['Задания', 'Topshiriqlar'], ['Ещё', 'Yana'],
  ['Мои клиенты', 'Mijozlarim'], ['Клиенты', 'Mijozlar'], ['Договоры', 'Shartnomalar'], ['Склад', 'Ombor'], ['Дисциплина', 'Intizom'], ['Чат с руководителем', 'Rahbar bilan chat'], ['Чат', 'Chat'], ['Академия', 'Akademiya'],
  ['Разделы', 'Boʻlimlar'], ['Установить приложение', 'Ilovani oʻrnatish'], ['Загружаю…', 'Yuklanmoqda…'],
  ['Кабинет склада ещё не настроен: руководитель должен включить автозагрузку в своей CRM.', 'Ombor kabineti hali sozlanmagan: rahbar oʻz CRM-ida avtoyuklashni yoqishi kerak.'],
  ['Сервер склада ответил с ошибкой. Сообщите руководителю и попробуйте позже.', 'Ombor serveri xato bilan javob berdi. Rahbarga xabar bering va keyinroq urinib koʻring.'],
  ['⚠ Данные давно не обновлялись — напишите руководителю, пусть откроет CRM.', '⚠ Maʼlumotlar uzoq vaqt yangilanmagan — rahbarga yozing, CRM-ni ochsin.'],
  ['Нет интернета — показаны последние сохранённые данные', 'Internet yoʻq — oxirgi saqlangan maʼlumotlar koʻrsatilmoqda'],
  ['Нет интернета. Откройте страницу, когда появится связь.', 'Internet yoʻq. Aloqa paydo boʻlganda sahifani oching.'],
  ['Кабинет ещё не готов: ваш руководитель должен открыть свою CRM — кабинет появится через минуту.', 'Kabinet hali tayyor emas: rahbaringiz CRM ni ochishi kerak — kabinet bir daqiqada paydo boʻladi.'],
  ['Период', 'Davr'], ['осталось', 'qoldi'], ['дн.', 'kun'], ['Обновлено: план', 'Yangilangan: reja'], ['долги', 'qarzlar'], ['склад', 'ombor'],

  // main
  ['📈 Темп периода', '📈 Davr surʼati'], ['Прошло', 'Oʻtdi'], ['Чёрная черта — где нужно быть сегодня, чтобы закрыть план к', 'Qora chiziq — rejani bajarish uchun bugun qayerda boʻlish kerakligi, muddat:'],
  ['Продажи', 'Sotuv'], ['✓ по темпу впереди на', '✓ surʼat boʻyicha oldindasiz:'], ['по темпу должно быть', 'surʼat boʻyicha boʻlishi kerak'], ['не хватает', 'yetishmaydi'],
  ['сегодня продать', 'bugun sotish'], ['сегодня собрать', 'bugun yigʻish'],
  ['📋 Что сделать сегодня', '📋 Bugun nima qilish kerak'], ['обещал сегодня', 'bugun toʻlashni vaʼda qilgan'], ['просрочено', 'muddati oʻtgan'], ['обещал', 'vaʼda qilgan'], ['позвонить', 'qoʻngʻiroq qilish'],
  ['Сегодня по графику должны заплатить', 'Bugun jadval boʻyicha toʻlashi kerak:'], ['клиентов на', 'ta mijoz, jami'], ['кто именно', 'kimlar'],
  ['Маршрут на сегодня', 'Bugungi marshrut'], ['точек', 'nuqta'], ['открыть', 'ochish'],
  ['Очередь сбора:', 'Undiruv navbati:'], ['должников —', 'qarzdor —'], ['открыть и отметить результат', 'ochib natijani belgilash'],
  ['Открытых заданий:', 'Ochiq topshiriqlar:'], ['есть просроченные', 'muddati oʻtganlari bor'],
  ['Первый фотоотчёт в LINKO — до', 'LINKO dagi birinchi fotohisobot — soat'], ['иначе штраф', 'aks holda jarima'], ['сум за минуту', 'soʻm har daqiqaga'],
  ['Продано', 'Sotildi'], ['план не задан', 'reja belgilanmagan'], ['пул не задан', 'pul belgilanmagan'], ['Собрано', 'Yigʻildi'], ['пул', 'pul'], ['план', 'reja'],
  ['Долг ваших клиентов', 'Mijozlaringiz qarzi'], ['должников', 'qarzdorlar'], ['Место в рейтинге', 'Reytingdagi oʻrin'], ['вы лидер — держите темп 💪', 'siz yetakchisiz — surʼatni saqlang 💪'],
  ['по % плана продаж и сбора', 'sotuv va undiruv rejasi % boʻyicha'], ['-го места:', '-oʻringa:'], ['продаж)', 'sotuv)'], ['п.п.', 'p.p.'],
  ['Сегодня', 'Bugun'], ['отчёт в', 'hisobot'], ['нет отчёта', 'hisobot yoʻq'], ['вовремя ✓', 'oʻz vaqtida ✓'], ['опоздание', 'kechikish'], ['мин', 'daq'], ['штраф', 'jarima'], ['сум', 'soʻm'],
  ['отмечен невыход на работу', 'ishga chiqmagan deb belgilangan'], ['без штрафа за опоздание', 'kechikish uchun jarimasiz'], ['первый фотоотчёт до', 'birinchi fotohisobot soat'],
  ['Штрафы за период', 'Davrdagi jarimalar'], ['опозданий', 'kechikishlar'], ['АКБ / ОКБ', 'AKB / OKB'], ['активные / все клиенты', 'faol / barcha mijozlar'],
  ['Зарплата за', 'Ish haqi:'], ['Расчёт руководителя за закрытый месяц', 'Rahbarning yopilgan oy hisob-kitobi'], ['К выплате', 'Toʻlanadi'], ['Фикс', 'Fiks'], ['Итого в $', 'Jami $'], ['курс', 'kurs'],
  ['Газ / метан', 'Gaz / metan'], ['км', 'km'], ['Ваучер в ресторан на', 'Restoranga vaucher:'], ['поздравляем!', 'tabriklaymiz!'], ['Аванс', 'Avans'], ['Штраф за опоздания', 'Kechikish jarimasi'],
  ['Рейтинг агентов', 'Agentlar reytingi'], ['Место — по сумме % плана продаж и % сбора пула', 'Oʻrin — sotuv rejasi % va pul undiruvi % yigʻindisi boʻyicha'], ['Агент', 'Agent'], ['План продаж', 'Sotuv rejasi'], ['Сбор пула', 'Pul undiruvi'], ['— вы', '— siz'],
  ['Кому собрать в первую очередь', 'Birinchi navbatda kimdan yigʻish kerak'], ['по пулу осталось', 'pul boʻyicha qoldi'], ['посл. оплата', 'oxirgi toʻlov'], ['Позвонить', 'Qoʻngʻiroq'],
  ['🛒 Давно не покупали — предложите заказ', '🛒 Anchadan beri xarid qilmagan — buyurtma taklif qiling'], ['посл. покупка', 'oxirgi xarid'], ['долга нет', 'qarz yoʻq'],
  ['Эти клиенты брали товар, но перестали — каждый вернувшийся клиент поднимает и продажи, и АКБ.', 'Bu mijozlar tovar olgan, lekin toʻxtagan — qaytgan har bir mijoz sotuvni ham, AKB ni ham oshiradi.'],
  ['Курсы для агентов: продажи, работа с клиентами и долгами, товары', 'Agentlar uchun kurslar: sotuv, mijozlar va qarzlar bilan ishlash, tovarlar'], ['Перейти к курсам →', 'Kurslarga oʻtish →'],
  ['💬 Чат с руководителем', '💬 Rahbar bilan chat'], ['💬 Написать руководителю', '💬 Rahbarga yozish'],

  // install, language
  ['📲 Приложение на телефоне', '📲 Telefondagi ilova'], ['📲 Установить приложение', '📲 Ilovani oʻrnatish'],
  ['Иконка MITAL появится на экране телефона — кабинет будет открываться как обычное приложение, без браузера.', 'MITAL belgisi telefon ekranida paydo boʻladi — kabinet brauzersiz, oddiy ilova kabi ochiladi.'],
  ['Откройте кабинет в', 'Kabinetni oching:'], ['Нажмите кнопку', 'Tugmani bosing:'], ['«Поделиться»', '«Ulashish»'], ['(квадрат со стрелкой вверх).', '(yuqoriga strelkali kvadrat).'],
  ['Выберите', 'Tanlang:'], ['«На экран „Домой“»', '«Bosh ekranga»'], ['«Добавить».', '«Qoʻshish».'], ['Нажмите меню', 'Menyuni bosing'], ['справа вверху.', 'oʻng yuqorida.'],
  ['«Установить приложение»', '«Ilovani oʻrnatish»'], ['или «Добавить на главный экран».', 'yoki «Bosh ekranga qoʻshish».'],

  // collect
  ['Сегодня собрать', 'Bugun yigʻish'], ['чтобы закрыть пул к концу периода', 'davr oxirigacha pulni yopish uchun'], ['Отработано сегодня', 'Bugun ishlangan'], ['отметьте каждого, с кем связались', 'bogʻlangan har bir mijozni belgilang'],
  ['Сегодня продать', 'Bugun sotish'], ['чтобы закрыть план продаж', 'sotuv rejasini bajarish uchun'], ['Кого дожимать сегодня', 'Bugun kim bilan ishlash kerak'], ['Должников в очереди нет 👏', 'Navbatda qarzdor yoʻq 👏'],
  ['Сверху — самые важные: просрочка и сорванные обещания. После звонка или визита нажмите результат — руководитель видит его сразу.', 'Yuqorida — eng muhimlari: muddati oʻtgan va buzilgan vaʼdalar. Qoʻngʻiroq yoki tashrifdan keyin natijani bosing — rahbar uni darhol koʻradi.'],
  ['Оплатил', 'Toʻladi'], ['Обещал', 'Vaʼda berdi'], ['Отказ', 'Rad etdi'], ['Недозвон', 'Javob bermadi'], ['отмечено сегодня', 'bugun belgilandi'], ['в прошлый раз', 'oʻtgan safar'],
  ['сорвал обещание', 'vaʼdani buzdi'], ['дн. без оплаты', 'kun toʻlovsiz'], ['просрочка 61+ дн.', 'muddati 61+ kun oʻtgan'], ['просрочка 31–60 дн.', 'muddati 31–60 kun oʻtgan'],
  ['Когда заплатит', 'Qachon toʻlaydi'], ['Сколько, $', 'Qancha, $'], ['Сколько заплатил, $', 'Qancha toʻladi, $'], ['Причина отказа', 'Rad etish sababi'], ['Заметка', 'Izoh'], ['что сказал клиент', 'mijoz nima dedi'], ['необязательно', 'ixtiyoriy'],
  ['Отправить:', 'Yuborish:'], ['Укажите дату и сумму обещания', 'Vaʼda sanasi va summasini kiriting'], ['Напишите причину отказа', 'Rad etish sababini yozing'],

  // payments calendar
  ['📅 Календарь оплат', '📅 Toʻlovlar taqvimi'], ['Сегодня должны', 'Bugun toʻlashi kerak'], ['оплат', 'toʻlov'], ['Просрочено', 'Muddati oʻtgan'], ['Ждём до', 'Kutilmoqda:'], ['по графикам и обещаниям', 'jadvallar va vaʼdalar boʻyicha'],
  ['— сегодня', '— bugun'], ['В этот день оплат по графику нет.', 'Bu kuni jadval boʻyicha toʻlov yoʻq.'], ['Всего', 'Jami'], ['оплачено', 'toʻlangan'],
  ['🔴 Просрочено — собрать в первую очередь', '🔴 Muddati oʻtgan — birinchi navbatda yigʻish'], ['Спец · разовый договор', 'Maxsus · bir martalik shartnoma'], ['Договор', 'Shartnoma'], ['Обещание', 'Vaʼda'],
  ['✓ оплачено', '✓ toʻlangan'], ['ждём', 'kutilmoqda'], ['Заказ №', 'Buyurtma №'], ['часть', 'qism'], ['свой график', 'oʻz jadvali'], ['Договор на', 'Shartnoma muddati:'], ['мес.', 'oy'],
  ['платёж за месяц', 'oy toʻlovi'], ['уже оплатил', 'allaqachon toʻladi'], ['Обещал по звонку', 'Qoʻngʻiroqda vaʼda berdi'], ['График оплат клиента', 'Mijozning toʻlov jadvali'],
  ['Календарь появится после следующего обновления кабинета руководителем.', 'Taqvim rahbar kabinetni keyingi yangilaganda paydo boʻladi.'],

  // route
  ['🗺 Маршрут', '🗺 Marshrut'], ['Маршрут ещё не составлен. Попросите руководителя заполнить его в CRM: Агенты → Маршруты.', 'Marshrut hali tuzilmagan. Rahbardan CRM da toʻldirishni soʻrang: Agentlar → Marshrutlar.'],
  ['Понедельник', 'Dushanba'], ['Вторник', 'Seshanba'], ['Среда', 'Chorshanba'], ['Четверг', 'Payshanba'], ['Пятница', 'Juma'], ['Суббота', 'Shanba'], ['· сегодня', '· bugun'],
  ['Визиты сегодня в LINKO', 'Bugungi tashriflar (LINKO)'], ['отмечайте визит у каждого клиента', 'har bir mijozda tashrifni belgilang'], ['к оплате сейчас', 'hozir toʻlash kerak'],
  ['покупок не было — предложите заказ', 'xarid boʻlmagan — buyurtma taklif qiling'], ['🧭 Карта', '🧭 Xarita'], ['долг на маршруте', 'marshrutdagi qarz'], ['Порядок — как задал руководитель.', 'Tartib — rahbar belgilaganidek.'],

  // contracts
  ['📄 Договоры', '📄 Shartnomalar'], ['Договоры появятся после следующего обновления кабинета руководителем.', 'Shartnomalar rahbar kabinetni keyingi yangilaganda paydo boʻladi.'],
  ['🧾 Разовые договоры и спецпредложения', '🧾 Bir martalik shartnomalar va maxsus takliflar'], ['спецпредложение', 'maxsus taklif'], ['скидка', 'chegirma'], ['оплачено полностью', 'toʻliq toʻlangan'],
  ['Разовых договоров нет.', 'Bir martalik shartnomalar yoʻq.'], ['Каждый заказ на спеццене платится по своему графику — по частям. Красным — просроченные части.', 'Maxsus narxdagi har bir buyurtma oʻz jadvali boʻyicha — qismlarga boʻlib toʻlanadi. Qizil — muddati oʻtgan qismlar.'],
  ['🧾 Разовые и спец', '🧾 Bir martalik va maxsus'], ['⏰ Ближайшие оплаты', '⏰ Yaqin toʻlovlar'], ['Всего ждём', 'Jami kutilmoqda'], ['просрочено с', 'muddati oʻtgan:'], ['через', 'yana'], ['завтра', 'ertaga'],
  ['📑 Большие договоры', '📑 Katta shartnomalar'], ['Больших договоров нет.', 'Katta shartnomalar yoʻq.'], ['просрочено месяцев:', 'muddati oʻtgan oylar:'], ['опл.', 'toʻl.'],
  ['Сумма месяца должна прийти до последнего дня этого месяца договора.', 'Oylik summa shartnomaning shu oyi oxirgi kunigacha kelishi kerak.'],

  // clients, stock
  ['Поиск клиента', 'Mijozni qidirish'], ['Все', 'Hammasi'], ['Должники', 'Qarzdorlar'], ['Обещали', 'Vaʼda berganlar'], ['Не покупали 21+ дн.', '21+ kun xarid qilmagan'], ['Ещё не покупали', 'Hali xarid qilmagan'], ['Купили в периоде', 'Davrda xarid qilgan'],
  ['Нет клиентов по этому фильтру.', 'Bu filtr boʻyicha mijoz yoʻq.'], ['Долг:', 'Qarz:'], ['купили:', 'xarid:'], ['оплатили:', 'toʻlov:'], ['сверху самые большие долги', 'yuqorida eng katta qarzlar'],
  ['купил', 'xarid'], ['оплатил', 'toʻladi'], ['покупок не было', 'xarid boʻlmagan'],
  ['Поиск товара, бренда, артикула', 'Tovar, brend, artikul qidirish'], ['Склад не назначен', 'Ombor biriktirilmagan'], ['Попросите руководителя указать ваш склад.', 'Rahbardan omboringizni koʻrsatishni soʻrang.'],
  ['всего', 'jami'], ['в резерве', 'zaxirada'], ['шт', 'dona'], ['Остатки на', 'Qoldiqlar:'], ['(обновляются каждые 5 минут)', '(har 5 daqiqada yangilanadi)'], ['«Доступно» — без резерва под заказы.', '«Mavjud» — buyurtmalar zaxirasisiz.'],

  // tasks
  ['открыто', 'ochiq'], ['Заданий нет.', 'Topshiriq yoʻq.'], ['в работе', 'bajarilmoqda'], ['возвращено — доделать', 'qaytarildi — tugatish kerak'], ['на проверке', 'tekshiruvda'], ['✓ принято', '✓ qabul qilindi'],
  ['отправлено руководителю', 'rahbarga yuborildi'], ['Факт:', 'Fakt:'], ['✅ Выполнено', '✅ Bajarildi'], ['🎓 Открыть урок', '🎓 Darsni ochish'], ['Открыть ссылку', 'Havolani ochish'],
  ['Комментарий', 'Izoh'], ['Что сделано', 'Nima qilindi'], ['Фото (необязательно)', 'Foto (ixtiyoriy)'], ['Отмена', 'Bekor qilish'], ['Отправить руководителю', 'Rahbarga yuborish'], ['Отправляю…', 'Yuborilmoqda…'],
  ['Напишите комментарий или приложите фото', 'Izoh yozing yoki foto biriktiring'], ['Отправлено руководителю ✓', 'Rahbarga yuborildi ✓'], ['Вопрос по заданию?', 'Topshiriq boʻyicha savol?'],
  ['Нажмите «Выполнено», напишите, что сделано, и приложите фото, если нужно — руководитель получит это сразу.', '«Bajarildi» ni bosing, nima qilinganini yozing va kerak boʻlsa foto biriktiring — rahbar darhol oladi.'],
  ['Сбор оплаты', 'Toʻlov undirish'], ['Продажа', 'Sotuv'], ['Погашение долга', 'Qarzni toʻlash'],

  // discipline
  ['Опозданий', 'Kechikishlar'], ['Невыходов', 'Ishga chiqmaslik'], ['Ранний уход', 'Erta ketish'], ['визитов из плана за период', 'davrdagi rejadan tashriflar'], ['Табель за период (16–15)', 'Davr tabeli (16–15)'],
  ['Явка', 'Davomat'], ['ранний уход', 'erta ketish'], ['невыходов', 'chiqmaslik'], ['📝 Отсутствие', '📝 Ishda boʻlmaslik'], ['Причина', 'Sabab'], ['По дням', 'Kunlar boʻyicha'],
  ['День', 'Kun'], ['Первый отчёт', 'Birinchi hisobot'], ['Опоздание', 'Kechikish'], ['Штраф', 'Jarima'], ['Визиты', 'Tashriflar'], ['Заявка', 'Ariza'], ['Ответ', 'Javob'],
  ['✓ подтверждена', '✓ tasdiqlandi'], ['отклонена', 'rad etildi'], ['ждёт ответа', 'javob kutmoqda'], ['Данных о дисциплине пока нет.', 'Intizom maʼlumotlari hali yoʻq.'],
  ['Проверьте даты', 'Sanalarni tekshiring'], ['Напишите причину', 'Sababini yozing'], ['✓ Заявка отправлена руководителю. Ответ придёт в Telegram.', '✓ Ariza rahbarga yuborildi. Javob Telegram ga keladi.'],
  ['Больничный', 'Kasallik'], ['Командировка', 'Xizmat safari'], ['Отпросился', 'Ruxsat soʻradi'], ['Семейные обстоятельства', 'Oilaviy sabablar'], ['Отпуск', 'Taʼtil'], ['Невыход', 'Ishga chiqmadi'],

  // store keeper
  ['Сверка склада', 'Ombor sanogʻi'], ['Начать сверку', 'Sanoqni boshlash'], ['Отправить сверку', 'Sanoqni yuborish'], ['Пересчитайте товары', 'Tovarlarni qayta sanang'], ['Поиск товара', 'Tovar qidirish'],
  ['только непосчитанные', 'faqat sanalmaganlar'], ['Отменить', 'Bekor qilish'], ['Отправить', 'Yuborish'], ['Товара нет', 'Tovar yoʻq'], ['коробка', 'quti'],

  // days of the week (calendar strip, discipline calendar)
  ['пн', 'Du'], ['вт', 'Se'], ['ср', 'Ch'], ['чт', 'Pa'], ['пт', 'Ju'], ['сб', 'Sh'], ['вс', 'Ya'],
  // short words left between translated phrases (whole words only)
  ['сегодня', 'bugun'], ['до', 'gacha'], ['из', '/'], ['или', 'yoki'], ['и', 'va'], ['нет', 'yoʻq'], ['долг', 'qarz'], ['Долг', 'Qarz'], ['клиентов', 'mijoz'], ['точек', 'nuqta'], ['оплата', 'toʻlov'],

  ['Выйти из аккаунта на этом телефоне?', 'Bu telefonda akkauntdan chiqasizmi?'], ['🚪 Выйти из аккаунта', '🚪 Akkauntdan chiqish'], ['Выйти из аккаунта', 'Akkauntdan chiqish'],

  // errors and system messages
  ['Нет доступа — обновите кабинет и попробуйте ещё раз', 'Ruxsat yoʻq — kabinetni yangilab qayta urinib koʻring'], ['Не отправилось:', 'Yuborilmadi:'], ['Войдите снова', 'Qayta kiring'],
  ['Кабинет ещё не готов — обновите через минуту', 'Kabinet hali tayyor emas — bir daqiqadan soʻng yangilang'], ['Фото не отправилось:', 'Foto yuborilmadi:'],
  // contracts: search, the contract picture, the client card
  ['🔎 Поиск: клиент, № договора', '🔎 Qidiruv: mijoz, shartnoma №'], ['ничего не найдено', 'hech narsa topilmadi'], ['По запросу', 'Soʻrov boʻyicha'],
  ['Нажмите на договор — откроется его картинка, на имя клиента — карточка клиента.', 'Shartnomani bosing — rasmi ochiladi, mijoz nomini bosing — mijoz kartasi ochiladi.'],
  ['📤 Отправить картинкой', '📤 Rasm qilib yuborish'], ['🖼 Сохранить картинку', '🖼 Rasmni saqlash'], ['🔍 Крупнее', '🔍 Kattaroq'], ['🔍 По ширине экрана', '🔍 Ekran kengligida'],
  ['👤 Карточка клиента', '👤 Mijoz kartasi'], ['Картинка сохранена', 'Rasm saqlandi'], ['Не получилось сделать картинку:', 'Rasm qilib boʻlmadi:'],
  ['Этот телефон не умеет отправлять файлы — сохраните картинку', 'Bu telefon fayl yubora olmaydi — rasmni saqlang'],
  ['📦 Заказы', '📦 Buyurtmalar'], ['💵 Оплаты', '💵 Toʻlovlar'], ['📈 По дням', '📈 Kunlar boʻyicha'], ['🛒 Покупки', '🛒 Xaridlar'],
  ['весь период', 'butun davr'], ['Купил за период', 'Davr ichida oldi'], ['Оплатил за период', 'Davr ichida toʻladi'], ['Ближайший срок', 'Eng yaqin muddat'],
  ['Долг прошлых периодов', 'Oldingi davrlar qarzi'], ['Не оплачены', 'Toʻlanmagan'], ['Оплачены за выбранные дни', 'Tanlangan kunlarda toʻlangan'],
  ['📄 договор — нажмите', '📄 shartnoma — bosing'], ['🤝 срок по договорённости', '🤝 kelishilgan muddat'], ['стандартный график', 'standart jadval'],
  ['✓ Все заказы оплачены', '✓ Barcha buyurtmalar toʻlangan'], ['Оплачено за выбранные дни:', 'Tanlangan kunlarda toʻlangan:'], ['Оплат в эти дни нет.', 'Bu kunlarda toʻlov yoʻq.'],
  ['Купил за выбранные дни:', 'Tanlangan kunlarda oldi:'], ['Что покупал больше всего', 'Eng koʻp nima olgan'], ['По заказам', 'Buyurtmalar boʻyicha'], ['Покупок в эти дни нет.', 'Bu kunlarda xarid yoʻq.'],
  ['Долг на конец дня', 'Kun oxiridagi qarz'], ['В эти дни данных нет.', 'Bu kunlarda maʼlumot yoʻq.'], ['Возвраты', 'Qaytarishlar'],
  ['Заказы, оплаты и покупки клиента появятся после следующего обновления кабинета руководителем.', 'Mijozning buyurtmalari, toʻlovlari va xaridlari rahbar kabinetni keyingi yangilaganida chiqadi.'],
];
