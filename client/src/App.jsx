import { useState } from "react";
import "./App.css";

function App() {
  const [showForm, setShowForm] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
  });

  const [message, setMessage] = useState("");

  const handleChange = (event) => {
    const { name, value } = event.target;

    setFormData({
      ...formData,
      [name]: value,
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    setMessage("");

    try {
      const response = await fetch("http://localhost:5000/api/registrations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.message);
        return;
      }

      setMessage(data.message);

      setFormData({
        name: "",
        email: "",
        phone: "",
      });
    } catch (error) {
      console.error("Registration error:", error);
      setMessage("Unable to connect to the server.");
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Event Registration</h1>
        <p>Register for upcoming events</p>
      </header>

      <main className="main">
        {!showForm ? (
          <section className="event-card">
            <h2>Upcoming Event</h2>

            <h3>Tech Meetup 2026</h3>

            <p>
              Join us for an exciting technology meetup and connect with
              developers and technology enthusiasts.
            </p>

            <div className="event-details">
              <p>📅 September 20, 2026</p>
              <p>📍 Bhopal</p>
            </div>

            <button onClick={() => setShowForm(true)}>Register Now</button>
          </section>
        ) : (
          <section className="form-card">
            <h2>Register for Event</h2>

            {message && <p className="message">{message}</p>}

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="name">Full Name</label>

                <input
                  id="name"
                  name="name"
                  type="text"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="Enter your full name"
                />
              </div>

              <div className="form-group">
                <label htmlFor="email">Email</label>

                <input
                  id="email"
                  name="email"
                  type="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="Enter your email"
                />
              </div>

              <div className="form-group">
                <label htmlFor="phone">Phone</label>

                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={handleChange}
                  placeholder="Enter your phone number"
                />
              </div>

              <div className="form-actions">
                <button type="button" onClick={() => setShowForm(false)}>
                  Back
                </button>

                <button type="submit">Submit Registration</button>
              </div>
            </form>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
