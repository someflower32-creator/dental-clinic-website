document.addEventListener('DOMContentLoaded', function() {
    // === Обработка формы записи через AJAX (если используется на странице contact) ===
    const form = document.getElementById('appointmentForm');
    const messageDiv = document.getElementById('formMessage');
    if (form && !form.hasAttribute('data-ajax-processed')) {
        form.setAttribute('data-ajax-processed', 'true');
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            const formData = new FormData(form);
            const data = Object.fromEntries(formData.entries());
            try {
                const response = await fetch('/api/appointment', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                if (response.ok) {
                    if (messageDiv) messageDiv.innerHTML = '<div class="success-message">Спасибо! Ваша заявка отправлена.</div>';
                    else alert('Спасибо! Ваша заявка отправлена.');
                    form.reset();
                } else {
                    let errorMsg = 'Ошибка при отправке';
                    try { const errorData = await response.json(); errorMsg = errorData.error || errorMsg; } catch(e) {}
                    if (messageDiv) messageDiv.innerHTML = `<div class="error-message">${errorMsg}</div>`;
                    else alert('Ошибка: ' + errorMsg);
                }
            } catch (err) {
                console.error(err);
                if (messageDiv) messageDiv.innerHTML = '<div class="error-message">Произошла ошибка при отправке. Попробуйте позже.</div>';
                else alert('Произошла ошибка при отправке.');
            }
        });
    }

    // === Анимация карточек ===
    const cards = document.querySelectorAll('.service-card, .feature');
    cards.forEach(card => {
        card.addEventListener('mouseenter', () => {
            card.style.transition = 'transform 0.3s, box-shadow 0.3s';
            card.style.boxShadow = '0 5px 15px rgba(0,0,0,0.2)';
        });
        card.addEventListener('mouseleave', () => {
            card.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
        });
    });
});
