# Revisor de calidad de datos

Abre `index.html` con doble clic (mejor en Chrome o Edge) y arrastra uno o varios `.xlsx`. No necesita instalar nada.
Los archivos se leen dentro del navegador: la página tiene una regla que le prohíbe enviar datos a internet.

## Si cambia algo
- Columnas, escalas de riesgo, años y rangos: se ajustan en `js/reglas.js`.
- Para probar sin datos reales: `ejemplo/ejemplo_con_errores.xlsx`, con errores puestos a propósito y datos inventados.

## Reglas que vienen de la respuesta de TI
- Solo se revisan las columnas que empiezan con "_", más Nombre del informe, Grado de riesgo, Departamento, NIT, Sector y CIIU.
  Las demás son data cruda de HSE.
- NA significa "No aplica": no se marca en GES, Área, TLV ni IR. NR significa "No reporta" y sí se marca.
- En Sonometría no se revisa el GES, porque son mediciones de área.
- Grado de riesgo: de A a E, salvo Confort Térmico (Confortable / No confortable) e Iluminación (de Muy bajo a Muy alto, Cumple / No cumple).

## Privacidad
Cédulas y nombres de empleados no se revisan ni salen en el Excel de correcciones.
