from flask import Flask, render_template
app = Flask(__name__)

@app.route('/loja')
def homepage():
    return render_template('loja.html')


@app.route('/compra-aprovada')
def compra_aprovada():
    return render_template ('compra_aprovada.html')

@app.route('/compra-recusada')
def compra_recusada():
    return render_template ('compra-recusada.html')

if __name__ == '__main__':
    app.run()
    
    # SDK do Mercado Pago
import mercadopago
# Adicione credenciais
sdk = mercadopago.SDK("TEST_ACCESS_TOKEN")
# Cria um item na preferência
preference_data = {
    "items": [
        {
            "title": "Meu produto",
            "quantity": 1,
            "unit_price": 75.76,
        }
    ]
}

preference_response = sdk.preference().create(preference_data)
preference = preference_response["response"]